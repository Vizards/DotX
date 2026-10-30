import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, toolData } from '../support/server.ts';

test('list_connections discovers the highest SemVer in any chosen channel and isolates caches', async (t) => {
  const outgoing = globalThis.fetch;
  const queries: URL[] = [];
  const release = (tag_name: string, draft = false, prerelease = true) => ({
    tag_name,
    draft,
    prerelease,
  });
  t.mock.method(globalThis, 'fetch', (input: any, init: any) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'api.github.com') return outgoing(input, init);
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    queries.push(url);
    return Promise.resolve(
      Response.json(
        url.pathname.endsWith('/latest')
          ? release('v0.0.4', false, false)
          : [
              release('v0.0.3-rc.2'),
              release('v0.0.4-dev.1'),
              release('v0.0.3-rc.10'),
              release('v0.0.3-rc.9'),
              release('v0.0.3-beta.2'),
              release('v0.0.3-dev.99'),
              release('v0.0.4-rc.1', true),
              release('v0.0.4-rc.2', false, false),
              release('v0.0.4', false, false),
              release('invalid-rc'),
            ],
      ),
    );
  });
  const api = await startServer(t, 'list', {
    releaseRepository: 'example/releases',
    releaseChannel: 'rc',
  });
  const token = await api.authorize();
  const read = async () => toolData((await api.tool(token, 'list_connections')).result).updates;
  for (const [channel, version] of [
    ['rc', '0.0.3-rc.10'],
    ['dev', '0.0.4-dev.1'],
    ['beta', '0.0.3-beta.2'],
    ['stable', '0.0.4'],
  ]) {
    await api.reload({ releaseChannel: channel });
    const found = await read();
    assert.equal(found.channel, channel);
    assert.equal(found.status, 'ok');
    assert.equal(found.latest.version, version);
    assert.equal(found.server_update_available, true);
    assert.equal(found.cached, false);
    assert.equal((await read()).cached, true);
  }
  assert.equal(queries.length, 4);
  assert.equal(queries[3]!.pathname, '/repos/example/releases/releases/latest');
  for (const url of queries.slice(0, 3)) assert.equal(url.search, '?per_page=100&page=1');

  await api.reload({ releaseChannel: 'rc' });
  assert.equal((await read()).cached, true);
  assert.equal(queries.length, 4);
  await api.reload({ releaseRepository: 'another/releases' });
  assert.equal((await read()).cached, false);
  assert.equal(queries.length, 5);
  await api.reload({ releaseChannel: 'canary' });
  const missing = await read();
  assert.equal(missing.status, 'ok');
  assert.equal(missing.latest, null);
  assert.equal(missing.server_update_available, null);
  assert.equal(queries.length, 6);
});

test('GitHub failure remains an unavailable update hint while MCP stays usable', async (t) => {
  const outgoing = globalThis.fetch;
  let queries = 0;
  t.mock.method(globalThis, 'fetch', (input: any, init: any) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'api.github.com') return outgoing(input, init);
    queries++;
    return Promise.resolve(Response.json({ message: 'API rate limit exceeded' }, { status: 403 }));
  });
  const api = await startServer(t, 'list', { releaseRepository: 'example/releases' });
  const token = await api.authorize();
  const device = await api.enroll();
  for (const cached of [false, true]) {
    const result = toolData((await api.tool(token, 'list_connections')).result);
    assert.equal(result.connections[0].connection_id, device.input.device_id);
    assert.equal(result.updates.status, 'unavailable');
    assert.equal(result.updates.diagnostic, 'GITHUB_HTTP_403');
    assert.equal(result.updates.server_update_available, null);
    assert.equal(result.updates.cached, cached);
  }
  assert.equal(queries, 1);
  assert(Array.isArray((await api.rpc(token, 'tools/list')).result.tools));
  await api.reload({ releaseRepository: '' });
  const disabled = toolData((await api.tool(token, 'list_connections')).result).updates;
  assert.equal(disabled.status, 'not_configured');
  assert.equal(disabled.server_update_available, null);
  assert.equal(queries, 1);
});
