import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { createTestHarness } from 'wrangler';
import { MCP_PROTOCOL_VERSION } from '@dotx/shared/protocol';

const origin = 'http://localhost';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function toolData(result: any) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

// Run the real Worker with disposable local KV/DO storage. Tests use only its
// public HTTP, MCP and device WebSocket interfaces, never internal storage/classes.
export async function startServer(t: TestContext) {
  const owner = randomUUID();
  const server = createTestHarness({
    workers: [
      {
        configPath: new URL('../../wrangler.json', import.meta.url),
        vars: { PUBLIC_ORIGIN: origin, RELEASE_REPOSITORY: '' },
        secrets: { OWNER_KEY_HASH: hash(owner) },
      },
    ],
  });
  t.after(() => server.close());
  await server.listen();
  // Use the Worker's HTTP binding, avoiding the dev proxy's URL rewriting.
  // A loopback origin also satisfies the local runtime's own origin checks.
  const entry = await server.getWorker().getExport();
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
  const ownerHeaders = { Authorization: `Bearer ${owner}` };
  const json = async (response: Awaited<ReturnType<typeof request>>) => {
    assert.equal(response.status, 200, await response.clone().text());
    return response.json() as Promise<any>;
  };
  const cookies = (response: Awaited<ReturnType<typeof request>>) =>
    response.headers
      .getSetCookie()
      .map((s) => s.split(';')[0])
      .join('; ');

  async function adminSession() {
    const link = await json(await post('/setup/browser', {}, ownerHeaders));
    const response = await request(link.url);
    assert.equal(response.status, 303);
    await response.text();
    return { cookie: cookies(response), link: link.url as string };
  }

  async function authorizeSession(scopes = ['mcp:read', 'mcp:write']) {
    const registration = await post('/oauth/register', {
      client_name: 'DotX API test',
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
    assert.equal(registration.status, 201);
    const { client_id } = (await registration.json()) as { client_id: string };
    const verifier = randomUUID() + randomUUID();
    const query = new URLSearchParams({
      client_id,
      redirect_uri: 'https://client.example/callback',
      response_type: 'code',
      scope: scopes.join(' '),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource: `${origin}/mcp`,
      state: randomUUID(),
    });
    const admin = await adminSession();
    const consent = await request(`/authorize?${query}`, { headers: { Cookie: admin.cookie } });
    assert.equal(consent.status, 200);
    const handle = /name="handle" value="([^"]+)"/.exec(await consent.text())?.[1];
    assert(handle, 'authorization page must provide a consent handle');
    const form = new URLSearchParams({ handle, decision: 'approve' });
    for (const scope of scopes) form.append('scope', scope);
    const approval = await request('/authorize', {
      method: 'POST',
      body: form.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: origin,
        Cookie: [admin.cookie, cookies(consent)].join('; '),
      },
    });
    assert.equal(approval.status, 302, await approval.clone().text());
    const callback = new URL(approval.headers.get('Location')!);
    assert.equal(callback.searchParams.get('state'), query.get('state'));
    const token = await request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id,
        code: callback.searchParams.get('code')!,
        code_verifier: verifier,
        redirect_uri: 'https://client.example/callback',
        resource: `${origin}/mcp`,
      }).toString(),
    });
    const tokens = await json(token);
    return {
      token: tokens.access_token as string,
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

  async function enroll() {
    const token = randomUUID(),
      claim = randomUUID();
    const input = {
      operation_id: randomUUID(),
      device_id: randomUUID(),
      label: 'Synthetic connector',
      token_hash: hash(token),
      claim_hash: hash(claim),
    };
    await json(await post('/setup/enroll', input));
    await json(await post('/setup/approve', { operation_id: input.operation_id }, ownerHeaders));
    return { input, token, claim };
  }
  return { request, authorize, authorizeSession, rpc, tool, enroll };
}
