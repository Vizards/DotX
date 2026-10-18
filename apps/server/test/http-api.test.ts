import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, origin, hash } from './support/server.ts';

test('public routes expose service metadata and require the appropriate credentials', async (t) => {
  const api = await startServer(t);
  assert.equal((await api.json(await api.request('/health'))).service, 'dotx-server');
  assert.equal((await api.json(await api.request('/setup/info'))).origin, origin);
  assert.equal((await api.request('https://wrong.example/health')).status, 421);
  assert.equal((await api.request('/mcp')).status, 401);
  assert.equal((await api.request('/device/connect')).status, 401);
  assert.equal((await api.post('/setup/browser', {})).status, 401);
  const rejected = await api.post('/mcp', {}, { Origin: 'http://127.0.0.1' });
  assert.equal(rejected.status, 403);
  assert.equal(((await rejected.json()) as { error: string }).error, 'BAD_ORIGIN');
});

test('enrollment requires administrator approval and isolates device and claim credentials', async (t) => {
  const api = await startServer(t);
  const token = randomUUID(),
    claim = randomUUID();
  const input = {
    operation_id: randomUUID(),
    device_id: randomUUID(),
    label: 'Test device',
    token_hash: hash(token),
    claim_hash: hash(claim),
  };
  assert.equal((await api.json(await api.post('/setup/enroll', input))).approved, false);
  assert.equal((await api.json(await api.post('/setup/enroll', input))).approved, false);
  const status = () =>
    api.post(
      '/setup/enroll/status',
      { operation_id: input.operation_id },
      {
        Authorization: `Bearer ${claim}`,
      },
    );
  assert.equal((await api.json(await status())).approved, false);
  assert.equal(
    (
      await api.post(
        '/setup/approve',
        { operation_id: input.operation_id },
        {
          Authorization: `Bearer ${token}`,
        },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await api.post(
        '/setup/enroll/status',
        { operation_id: input.operation_id },
        {
          Authorization: `Bearer ${token}`,
        },
      )
    ).status,
    400,
  );
  assert.equal(
    (await api.post('/setup/enroll', { ...input, label: 'Different device' })).status,
    400,
  );
  await api.json(
    await api.post('/setup/approve', { operation_id: input.operation_id }, api.ownerHeaders),
  );
  assert.equal((await api.json(await status())).device_id, input.device_id);
  assert.equal(
    (
      await api.request('/device/connect', {
        headers: {
          'X-Device-Id': input.device_id,
          Authorization: `Bearer ${token}`,
        },
      })
    ).status,
    426,
    'an approved device still needs a WebSocket upgrade',
  );
  await api.json(await api.post('/setup/revoke', { device_id: input.device_id }, api.ownerHeaders));
  assert.equal(
    (
      await api.request('/device/connect', {
        headers: {
          'X-Device-Id': input.device_id,
          Authorization: `Bearer ${token}`,
        },
      })
    ).status,
    401,
  );
});

test('administrator browser sessions coexist, use one-time links and enforce same-origin writes', async (t) => {
  const api = await startServer(t);
  const first = await api.adminSession(),
    second = await api.adminSession();
  for (const session of [first, second]) {
    assert.equal(
      (
        await api.json(
          await api.request('/setup/browser-status', {
            headers: { Cookie: session.cookie },
          }),
        )
      ).admin,
      true,
    );
  }
  assert.equal((await api.request(second.link)).status, 400);
  assert.equal(
    (
      await api.post(
        '/setup/approve',
        { operation_id: randomUUID() },
        {
          Cookie: second.cookie,
          Origin: 'http://127.0.0.1',
        },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api.post(
        '/setup/approve',
        { operation_id: randomUUID() },
        {
          Cookie: second.cookie,
        },
      )
    ).status,
    401,
  );
});

test('OAuth scopes are enforced through the actual MCP endpoint', async (t) => {
  const api = await startServer(t);
  const token = await api.authorize(['mcp:read']);
  const listing = await api.rpc(token, 'tools/list');
  assert(listing.result.tools.some((tool: { name: string }) => tool.name === 'list_connections'));
  assert.deepEqual(
    (await api.tool(token, 'list_connections')).result.structuredContent.connections,
    [],
  );
  const denied = await api.tool(token, 'call', {
    connection_id: 'not-registered',
    interface: 'app_server',
    runtime_id: 'opaque-runtime',
    request_id: randomUUID(),
    method: 'example/operation',
    params: {},
  });
  assert.equal(denied.result.isError, true);
  assert.equal(JSON.parse(denied.result.content[0].text).error.code, 'INSUFFICIENT_SCOPE');
});

test('event subscriptions reject unregistered devices and private callback addresses', async (t) => {
  const api = await startServer(t);
  const token = await api.authorize();
  const input = {
    name: 'gateway.native.event',
    arguments: { connection_id: randomUUID() },
    delivery: { mode: 'webhook', url: 'https://127.0.0.1/callback', secret: 'unused' },
  };
  const unauthorized = await api.rpc(token, 'events/subscribe', input);
  assert.equal(unauthorized.error.message, 'CONNECTION_NOT_AUTHORIZED');
  const device = await api.enroll();
  const rejected = await api.rpc(token, 'events/subscribe', {
    ...input,
    arguments: { connection_id: device.input.device_id },
  });
  assert.equal(rejected.error.code, -32015);
  assert.equal(rejected.error.data.reason, 'non_public_destination');
});
