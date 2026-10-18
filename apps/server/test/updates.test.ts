import test from 'node:test';
import assert from 'node:assert/strict';
import { ReleaseUpdates, updateAvailable } from '../src/updates/discovery.ts';
import { MemoryStore } from './fixtures/store.ts';

const release = (tag = 'v0.0.2') =>
  Response.json({ tag_name: tag, draft: false, prerelease: false });
test('default fetch does not pass the discovery instance as the native receiver', async (t) => {
  t.mock.method(globalThis, 'fetch', async function (this: unknown) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return release();
  });
  const result = await new ReleaseUpdates(new MemoryStore(), 'example/dotx').read();
  assert.equal(result.status, 'ok');
  assert.equal(result.latest!.version, '0.0.2');
});
test('release discovery coalesces calls, persists across hub restarts and compares each baseline', async () => {
  const store = new MemoryStore();
  let requests = 0;
  const fetcher: typeof fetch = async (url) => {
    assert.equal(url, 'https://api.github.com/repos/example/dotx/releases/latest');
    requests++;
    return release();
  };
  const updates = new ReleaseUpdates(store, 'example/dotx', undefined, fetcher);
  const [a, b] = await Promise.all([updates.read(), updates.read()]);
  assert.equal(requests, 1);
  assert.deepEqual(a, b);
  assert.equal(a.channel, 'stable');
  const cached = await new ReleaseUpdates(store, 'example/dotx', 'stable', fetcher).read();
  assert.equal(cached.cached, true);
  assert.equal(requests, 1);
  assert.equal(updateAvailable(cached, '0.0.1'), true);
  assert.equal(updateAvailable(cached, '0.0.2'), false);
  assert.equal(updateAvailable(cached, '0.0.10'), false);
  assert.equal(updateAvailable(cached, '0.0.2-dev.1'), true);
  assert.equal(updateAvailable(cached, null), null);
  assert.equal(updateAvailable(cached, 'unknown'), null);
  assert.equal(
    cached.latest!.update_skill_url,
    'https://raw.githubusercontent.com/example/dotx/v0.0.2/apps/desktop/skills/update/SKILL.md',
  );
});
test('dev discovery selects the highest published dev version across pages and isolates its cache', async () => {
  const store = new MemoryStore();
  await new ReleaseUpdates(store, 'example/dotx', 'stable', async () => release()).read();
  const item = (tag_name: string, prerelease = true, draft = false) => ({
    tag_name,
    prerelease,
    draft,
  });
  const first = [
    item('v0.0.2-dev.9.1'),
    item('v0.0.2-dev.99.1', true, true),
    item('v9.0.0', false),
    item('v9.0.0-beta.1'),
    item('invalid'),
    ...Array.from({ length: 95 }, () => item('v0.0.1-dev.1.1')),
  ];
  let requests = 0;
  const fetcher: typeof fetch = async (url) => {
    requests++;
    assert.equal(
      url,
      `https://api.github.com/repos/example/dotx/releases?per_page=100&page=${requests}`,
    );
    return Response.json(requests === 1 ? first : [item('v0.0.2-dev.10.1')]);
  };
  const value = await new ReleaseUpdates(store, 'example/dotx', 'dev', fetcher).read();
  assert.equal(value.channel, 'dev');
  assert.equal(value.status, 'ok');
  assert.equal(value.latest!.version, '0.0.2-dev.10.1');
  assert.equal(requests, 2);
  assert.equal(updateAvailable(value, '0.0.2-dev.9.1'), true);
  assert.equal(updateAvailable(value, '0.0.2-dev.10.1'), false);
  assert.equal(updateAvailable(value, '0.0.2'), false);
  assert.equal(
    value.latest!.update_skill_url,
    'https://raw.githubusercontent.com/example/dotx/v0.0.2-dev.10.1/apps/desktop/skills/update/SKILL.md',
  );
  assert.equal(
    (await new ReleaseUpdates(store, 'example/dotx', 'dev', fetcher).read()).cached,
    true,
  );
  const stable = await new ReleaseUpdates(store, 'example/dotx', 'stable', fetcher).read();
  assert.equal(stable.latest!.version, '0.0.2');
  assert.equal(requests, 2);
});
test('an empty dev channel has no update target and network failure retains dated dev evidence', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const store = new MemoryStore();
  const empty = await new ReleaseUpdates(store, 'example/dotx', 'dev', async () =>
    Response.json([]),
  ).read();
  assert.equal(empty.status, 'ok');
  assert.equal(empty.latest, null);
  assert.equal(updateAvailable(empty, '0.0.1'), null);
  t.mock.timers.tick(6 * 60 * 60_000);
  await new ReleaseUpdates(store, 'example/dotx', 'dev', async () =>
    Response.json([{ tag_name: 'v0.0.1-dev.5.1', prerelease: true, draft: false }]),
  ).read();
  t.mock.timers.tick(6 * 60 * 60_000);
  const failed = await new ReleaseUpdates(
    store,
    'example/dotx',
    'dev',
    async () => new Response('', { status: 403 }),
  ).read();
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.latest!.version, '0.0.1-dev.5.1');
  assert.equal(updateAvailable(failed, '0.0.1-dev.4.1'), true);
  assert.equal(updateAvailable(failed, '0.0.1-dev.5.1'), null);
});
test('failed checks retain dated evidence without reporting up to date or retrying each call', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const store = new MemoryStore();
  await new ReleaseUpdates(store, 'example/dotx', 'stable', async () => release()).read();
  t.mock.timers.tick(6 * 60 * 60_000);
  let requests = 0;
  const updates = new ReleaseUpdates(store, 'example/dotx', 'stable', async () => {
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
  t.mock.timers.tick(5 * 60_000);
  const recovered = await new ReleaseUpdates(store, 'example/dotx', 'stable', async () =>
    release(),
  ).read();
  assert.equal(recovered.cached, false);
  assert.equal(recovered.status, 'ok');
  assert.equal(updateAvailable(recovered, '0.0.2'), false);
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
    const result = await new ReleaseUpdates(new MemoryStore(), 'example/dotx', 'stable', async () =>
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
