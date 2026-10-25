import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, toolData } from '../support/server.ts';

test('approved OAuth connections use MCP without business scopes and still enforce revocation', async (t) => {
  const api = await startServer(t);
  const challenge = await api.request('/mcp', { method: 'POST' });
  assert.equal(challenge.status, 401);
  assert(!challenge.headers.get('WWW-Authenticate')?.includes('scope='));
  await challenge.text();
  const resource = await api.request('/.well-known/oauth-protected-resource/mcp');
  assert.equal(resource.status, 200);
  assert.equal(((await resource.json()) as any).scopes_supported, undefined);
  const metadata = await api.request('/.well-known/oauth-authorization-server');
  assert.equal(metadata.status, 200);
  assert.deepEqual(((await metadata.json()) as any).scopes_supported, ['offline_access']);
  const session = await api.authorizeSession();
  const token = session.token;
  const discovery = await api.rpc(token, 'server/discover');
  const info = discovery.result._meta['io.modelcontextprotocol/serverInfo'];
  assert.equal(info.name, 'dotx-remote');
  assert.equal(info.title, 'DotX Remote');
  assert.equal(typeof info.version, 'string');
  assert.equal(typeof info.description, 'string');
  assert.equal(info.websiteUrl, 'https://github.com/Vizards/DotX');
  assert.deepEqual(info.icons, [
    { src: 'http://localhost/branding/icon.png', mimeType: 'image/png', sizes: ['256x256'] },
  ]);
  const listing = await api.rpc(token, 'tools/list');
  assert.deepEqual(listing.result.tools.map((tool: { name: string }) => tool.name).sort(), [
    'call',
    'describe_methods',
    'get_instructions',
    'get_request',
    'list_connections',
    'read_events',
    'respond',
  ]);
  assert.deepEqual(toolData((await api.tool(token, 'list_connections')).result).connections, []);
  const offline = await api.authorizeSession(['offline_access']);
  const input = {
    connection_id: 'not-registered',
    interface: 'app_server',
    runtime_id: 'opaque-runtime',
    request_id: randomUUID(),
    method: 'example/operation',
  };
  // Renewal changes credentials, not which tools the approved connection can use.
  const refreshed = await session.refresh();
  const refreshedOffline = await offline.refresh();
  assert.equal(typeof refreshed, 'string');
  assert.equal(typeof refreshedOffline, 'string');
  for (const current of [token, offline.token, refreshed, refreshedOffline] as string[]) {
    const reply = await api.tool(current, 'call', input);
    assert.equal(reply.result.isError, true);
    assert.equal(toolData(reply.result).error.code, 'CONNECTION_NOT_AUTHORIZED');
    const response = await api.tool(current, 'respond', {
      event_id: 'not-observed',
      response: { result: {} },
    });
    assert.equal(toolData(response.result).error.code, 'EVENT_NOT_FOUND');
    assert(Array.isArray((await api.rpc(current, 'events/list')).result.events));
  }
  await session.revoke();
  for (const invalid of [token, refreshed, `${offline.token}tampered`, 'invalid-token']) {
    const response = await api.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${invalid}` },
    });
    assert.equal(response.status, 401);
    await response.text();
  }
  assert.deepEqual(
    toolData((await api.tool(refreshedOffline as string, 'list_connections')).result).connections,
    [],
  );
});

test('event subscriptions reject unregistered devices and private callback addresses', async (t) => {
  const api = await startServer(t);
  const token = await api.authorize();
  const input = {
    name: 'gateway.native.event',
    arguments: { connection_id: randomUUID(), request_id: 'future-send' },
    delivery: { mode: 'webhook', url: 'https://127.0.0.1/callback', secret: 'unused' },
  };
  const unauthorized = await api.rpc(token, 'events/subscribe', input);
  assert.equal(unauthorized.error.message, 'CONNECTION_NOT_AUTHORIZED');
  const device = await api.enroll();
  const rejected = await api.rpc(token, 'events/subscribe', {
    ...input,
    arguments: { connection_id: device.input.device_id, request_id: 'future-send' },
  });
  assert.equal(rejected.error.code, -32015, JSON.stringify(rejected.error));
  assert.equal(rejected.error.data.reason, 'non_public_destination');
});
