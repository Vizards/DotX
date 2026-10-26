import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import type { TestContext } from 'node:test';
import { createTestHarness } from 'wrangler';
import { cloudflareFixture } from './cloudflare.ts';
import { beginAuthorization } from './oauth.ts';
import { MCP_PROTOCOL_VERSION } from '../../src/mcp/protocol.ts';

const origin = 'http://localhost';

interface ServerOptions {
  assetsDirectory?: string;
  publicOrigin?: string;
  retentionDays?: string;
  main?: string;
  releaseRepository?: string;
  releaseChannel?: string;
}

export function toolData(result: any) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

// Run the real Worker with disposable local KV/DO storage. Tests use only its
// public HTTP, MCP and device WebSocket interfaces, never internal storage/classes.
export async function startServer(
  t: TestContext,
  membershipResponse: 'list' | 'detail' | 'paginated' = 'list',
  options: ServerOptions = {},
) {
  const cloudflare = cloudflareFixture(t, membershipResponse);
  const config = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../wrangler.json', import.meta.url).href), 'utf8'),
  );
  const server = createTestHarness({
    workers: [
      {
        config: {
          ...config,
          main: options.main ?? fileURLToPath(new URL('../../src/worker.ts', import.meta.url).href),
          // MCP tests need the binding, not the independently built Web application.
          assets: {
            ...config.assets,
            directory:
              options.assetsDirectory ??
              fileURLToPath(new URL('../../public', import.meta.url).href),
          },
          vars: {
            PUBLIC_ORIGIN: options.publicOrigin ?? origin,
            RELEASE_REPOSITORY: options.releaseRepository ?? '',
            RELEASE_CHANNEL: options.releaseChannel ?? 'stable',
            SERVICE_ID: '00000000-0000-4000-8000-000000000002',
            CF_ACCOUNT_ID: 'test-account',
            CF_WORKER_ID: 'test-worker',
            CF_WORKER_NAME: 'test-worker',
            ...(options.retentionDays ? { RECORD_RETENTION_DAYS: options.retentionDays } : {}),
          },
        },
      },
    ],
  });
  t.after(() => server.close());
  await server.listen();
  // Use the Worker's HTTP binding, avoiding the dev proxy's URL rewriting.
  // A loopback origin also satisfies the local runtime's own origin checks.
  let entry = await server.getWorker().getExport();
  async function reload(changes: ServerOptions) {
    await server.update((current) => ({
      ...current,
      workers: current.workers!.map((worker) => {
        assert('config' in worker, 'the fixture uses inline Worker configuration');
        return {
          ...worker,
          config: {
            ...worker.config,
            ...(changes.main ? { main: changes.main } : {}),
            vars: {
              ...worker.config?.vars,
              ...(changes.retentionDays ? { RECORD_RETENTION_DAYS: changes.retentionDays } : {}),
              ...(changes.releaseRepository !== undefined
                ? { RELEASE_REPOSITORY: changes.releaseRepository }
                : {}),
              ...(changes.releaseChannel !== undefined
                ? { RELEASE_CHANNEL: changes.releaseChannel }
                : {}),
            },
          },
        };
      }),
    }));
    entry = await server.getWorker().getExport();
  }
  const request = (
    path: string,
    init: Parameters<typeof server.fetch>[1] = {},
  ): Promise<Response> =>
    entry.fetch(new URL(path, origin).href, {
      redirect: 'manual',
      ...init,
    });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const ownerHeaders = { Authorization: 'Bearer synthetic-wrangler-oauth' };
  const json = async (response: Awaited<ReturnType<typeof request>>) => {
    assert(response.status === 200 || response.status === 201, await response.clone().text());
    return response.json() as Promise<any>;
  };
  const admin = (path: string, method = 'GET', body?: unknown) =>
    request('/admin/api' + path, {
      method,
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).then(json);
  async function authorizeSession(scopes?: string[], existing?: string) {
    const access = await admin(
      existing ? `/agents/${existing}/enrollment-code` : '/agents',
      'POST',
      existing ? undefined : { name: 'Synthetic agent' },
    );
    const flow = await beginAuthorization(request, scopes);
    const approval = await flow.approve(access.access_code);
    assert.equal(approval.status, 303, await approval.clone().text());
    const callback = new URL(approval.headers.get('Location')!);
    assert(callback.searchParams.has('code'), callback.href);
    assert.equal(callback.searchParams.get('state'), flow.query.get('state'));
    const tokens = await json(await flow.exchange(callback));
    const client_id = flow.client_id;
    return {
      token: tokens.access_token as string,
      agent_id: access.connection.agent_id as string,
      async refresh() {
        const response = await request('/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id,
            refresh_token: tokens.refresh_token,
            resource: `${origin}/mcp`,
          }).toString(),
        });
        if (response.ok) {
          const next = (await response.json()) as any;
          Object.assign(tokens, next);
          return next.access_token as string;
        }
        return { status: response.status, body: await response.json() };
      },
      async revoke() {
        assert(tokens.refresh_token, 'revoking the grant requires its refresh token');
        const response = await request('/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id,
            token: tokens.refresh_token,
            token_type_hint: 'refresh_token',
          }).toString(),
        });
        assert.equal(response.status, 200, await response.text());
      },
    };
  }
  const authorize = async (scopes?: string[]) => (await authorizeSession(scopes)).token;

  async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
    return json(
      await post(
        '/mcp',
        {
          jsonrpc: '2.0',
          id: randomUUID(),
          method,
          params: {
            ...params,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        },
        {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
          'Mcp-Method': method,
          ...(method === 'tools/call' ? { 'Mcp-Name': String(params.name) } : {}),
        },
      ),
    );
  }
  const tool = (token: string, name: string, args: Record<string, unknown> = {}) =>
    rpc(token, 'tools/call', { name, arguments: args });

  async function enroll(approve = true, name = 'Synthetic connector') {
    const keys = generateKeyPairSync('ed25519'),
      public_key = keys.publicKey.export({ format: 'jwk' });
    const input = {
      operation_id: randomUUID(),
      device_id: randomUUID(),
      name,
      public_key: { kty: public_key.kty, crv: public_key.crv, x: public_key.x },
    };
    const application = await json(await post('/setup/enroll', input));
    if (approve) await admin(`/device-requests/${input.operation_id}/approve`, 'POST');
    return { input, key: keys.privateKey, key_id: application.key_id as string };
  }
  async function connect(
    device: { input: { device_id: string }; key: KeyObject; key_id: string },
    options: { generation?: number; attempt?: number; wire?: number; version?: string } = {},
  ) {
    const query = new URLSearchParams({
      device_id: device.input.device_id,
      key_id: device.key_id,
      generation: String(options.generation ?? 1),
      attempt: String(options.attempt ?? 1),
      wire_protocol: String(options.wire ?? WIRE_VERSION),
      desktop_version: options.version ?? '0.1.0',
    });
    const response = await request('/device/connect?' + query, {
      headers: { Upgrade: 'websocket' },
    });
    assert.equal(response.status, 101, response.status === 101 ? '' : await response.text());
    const socket = response.webSocket!;
    t.after(() => {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    });
    const first = once(socket, 'message');
    socket.accept();
    const message = JSON.parse((await first)[0].data),
      header = Buffer.from(
        JSON.stringify({ alg: 'EdDSA', typ: 'dotx-device+jws', kid: device.key_id }),
      ).toString('base64url'),
      payload = Buffer.from(message.challenge).toString('base64url');
    const proof =
      header +
      '.' +
      payload +
      '.' +
      sign(null, Buffer.from(header + '.' + payload), device.key).toString('base64url');
    const next = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'proof', proof }));
    const result = JSON.parse((await next)[0].data);
    return { socket, result };
  }
  return {
    request,
    fetch: server.fetch.bind(server),
    cloudflare,
    authorize,
    authorizeSession,
    rpc,
    tool,
    enroll,
    connect,
    admin,
    reload,
  };
}
