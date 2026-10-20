import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, toolData } from './support/server.ts';

test('OAuth scopes are enforced through the actual MCP endpoint', async (t) => {
  const api = await startServer(t);
  const session = await api.authorizeSession(['mcp:read']);
  const token = session.token;
  const listing = await api.rpc(token, 'tools/list');
  assert(listing.result.tools.some((tool: { name: string }) => tool.name === 'list_connections'));
  assert.deepEqual(toolData((await api.tool(token, 'list_connections')).result).connections, []);
  const denied = await api.tool(token, 'call', {
    connection_id: 'not-registered',
    interface: 'app_server',
    runtime_id: 'opaque-runtime',
    method: 'example/operation',
    params: {},
  });
  assert.equal(denied.result.isError, true);
  assert.equal(JSON.parse(denied.result.content[0].text).error.code, 'INSUFFICIENT_SCOPE');

  const writer = await api.authorize();
  const input = {
    connection_id: 'not-registered',
    interface: 'app_server',
    runtime_id: 'opaque-runtime',
    request_id: randomUUID(),
    method: 'example/operation',
  };
  // Request-local authority must not leak between tokens with different scopes.
  for (const [current, expected] of [
    [writer, 'CONNECTION_NOT_AUTHORIZED'],
    [token, 'INSUFFICIENT_SCOPE'],
    [writer, 'CONNECTION_NOT_AUTHORIZED'],
  ]) {
    const reply = await api.tool(current!, 'call', input);
    assert.equal(reply.result.isError, true);
    assert.equal(toolData(reply.result).error.code, expected);
  }
  await session.revoke();
  for (const invalid of [token, `${writer}tampered`, 'invalid-token']) {
    const response = await api.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${invalid}` },
    });
    assert.equal(response.status, 401);
    await response.text();
  }
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
  assert.equal(rejected.error.code, -32015);
  assert.equal(rejected.error.data.reason, 'non_public_destination');
});
