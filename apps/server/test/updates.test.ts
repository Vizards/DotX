import test from 'node:test';
import assert from 'node:assert/strict';
import { ReleaseUpdates, updateAvailable } from '../src/updates/discovery.ts';
import { MemoryStore } from './fixtures/store.ts';

const release = (tag = 'v0.0.2') =>
  Response.json({ tag_name: tag, draft: false, prerelease: false });
test('release discovery coalesces calls, persists across hub restarts and compares each baseline', async () => {
  const store = new MemoryStore();
  let requests = 0;
  const fetcher: typeof fetch = async (url) => {
    assert.equal(url, 'https://api.github.com/repos/example/dotx/releases/latest');
    requests++;
    return release();
  };
  const updates = new ReleaseUpdates(store, 'example/dotx', fetcher);
  const [a, b] = await Promise.all([updates.read(), updates.read()]);
  assert.equal(requests, 1);
  assert.deepEqual(a, b);
  const cached = await new ReleaseUpdates(store, 'example/dotx', fetcher).read();
  assert.equal(cached.cached, true);
  assert.equal(requests, 1);
  assert.equal(updateAvailable(cached, '0.0.1'), true);
  assert.equal(updateAvailable(cached, '0.0.2'), false);
  assert.equal(updateAvailable(cached, '0.0.10'), false);
  assert.equal(updateAvailable(cached, '0.0.2-dev.1'), true);
  assert.equal(updateAvailable(cached, null), null);
  assert.equal(updateAvailable(cached, 'unknown'), null);
  assert.match(cached.latest!.update_skill_url, /v0\.0\.2\/update-SKILL\.md$/);
});
test('failed checks retain dated evidence without reporting up to date or retrying each call', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const store = new MemoryStore();
  await new ReleaseUpdates(store, 'example/dotx', async () => release()).read();
  t.mock.timers.tick(6 * 60 * 60_000);
  let requests = 0;
  const updates = new ReleaseUpdates(store, 'example/dotx', async () => {
    requests++;
    return new Response('', { status: 403 });
  });
  const failed = await updates.read();
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.diagnostic, 'GITHUB_HTTP_403');
  assert.equal(failed.checked_at, 1000);
  assert.equal(updateAvailable(failed, '0.0.1'), true);
  assert.equal(updateAvailable(failed, '0.0.2'), null);
  assert.equal((await updates.read()).cached, true);
  assert.equal(requests, 1);
});
test('no repository, no published stable release and invalid replies remain unknown', async () => {
  assert.equal((await new ReleaseUpdates(new MemoryStore()).read()).status, 'not_configured');
  for (const reply of [
    () => new Response('', { status: 404 }),
    () => Response.json({ tag_name: 'v0.0.1-dev.1', draft: false, prerelease: true }),
    () => release('nonsense'),
    () => {
      throw new Error('network unavailable');
    },
  ]) {
    const result = await new ReleaseUpdates(new MemoryStore(), 'example/dotx', async () =>
      reply(),
    ).read();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.latest, null);
    assert.equal(updateAvailable(result, '0.0.1'), null);
  }
});

test('authenticated list_connections exposes independent versions without an extra tool or blocking on GitHub failure', async () => {
  const { handleMcp } = await import('../src/mcp/handler.ts');
  const { MCP_PROTOCOL_VERSION } = await import('@dotx/shared/protocol');
  const { WIRE_VERSION } = await import('@dotx/shared/gateway');
  const { default: packageInfo } = await import('../package.json', { with: { type: 'json' } });
  const routes: Record<string, unknown> = {
    '/registry': [{ id: 'mini' }],
    '/devices': {
      freshnessMs: 45000,
      devices: [
        {
          deviceId: 'mini',
          availability: 'online',
          connectorVersion: '0.0.1',
          desktopVersion: '26.1000',
          interfaces: [],
        },
      ],
    },
    '/updates': {
      status: 'unavailable',
      latest: null,
      checked_at: null,
      attempted_at: 1000,
      cached: true,
      diagnostic: 'GITHUB_HTTP_403',
    },
    '/setup/info': { product: 'dotx', setup_protocol: 1, origin: 'https://service.example' },
    '/events': { ok: true, result: {} },
  };
  const env = {
    PUBLIC_ORIGIN: 'https://service.example',
    DEVICES: {
      getByName: () => ({
        fetch: async (url: string) => Response.json(routes[new URL(url).pathname]),
      }),
    },
  } as unknown as import('../src/env.ts').Env;
  const request = new Request('https://service.example/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      'Mcp-Method': 'tools/call',
      'Mcp-Name': 'list_connections',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'list_connections',
        arguments: {},
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
  const result = await (
    await handleMcp(request, env, { owner: true }, ['mcp:read'], {
      principal: 'owner',
      devices: ['mini'],
    })
  ).json<any>();
  const value = result.result.structuredContent;
  assert.equal(value.server_version, packageInfo.version);
  assert.equal(value.wire_protocol, WIRE_VERSION);
  assert.equal(value.connections[0].availability, 'online');
  assert.equal(value.connections[0].connector_version, '0.0.1');
  assert.equal(value.connections[0].desktop_version, '26.1000');
  assert.equal(value.connections[0].update_available, null);
  assert.equal(value.updates.diagnostic, 'GITHUB_HTTP_403');
  assert.equal(value.service.origin, env.PUBLIC_ORIGIN);
});
