import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import { startServer, toolData } from '../support/server.ts';
const heartbeat = {
  type: 'heartbeat',
  protocol: WIRE_VERSION,
  availability: 'online',
  interfaces: [{ name: 'app_server', runtime_id: 'opaque-runtime', availability: 'online' }],
};
const scopes = ['offline_access'];

test('MCP preserves device display names including empty, whitespace and large strings', async (t) => {
  const api = await startServer(t),
    token = await api.authorize();
  for (const name of ['', '   ', ` ${'x'.repeat(17 * 1024)} `]) {
    const device = await api.enroll(true, name);
    const connections = toolData((await api.tool(token, 'list_connections')).result).connections;
    assert.equal(
      connections.find(
        (row: { connection_id: string }) => row.connection_id === device.input.device_id,
      ).label,
      name,
    );
  }
});

test('MCP activates only the latest pending authorization and keeps refresh receipt ownership', async (t) => {
  const api = await startServer(t, 'detail'),
    device = await api.enroll(),
    first = await api.authorizeSession(scopes);
  const { socket } = await api.connect(device);
  const ack = once(socket, 'message');
  socket.send(JSON.stringify(heartbeat));
  await ack;
  let commands = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type !== 'command') return;
    commands++;
    socket.send(
      JSON.stringify({
        type: 'response',
        id: message.id,
        ok: true,
        result: { rpc_status: 'returned', native: { result: { opaque: true } } },
      }),
    );
  });
  const call = {
    connection_id: device.input.device_id,
    interface: 'app_server',
    runtime_id: 'opaque-runtime',
    method: 'example/opaque',
    request_id: randomUUID(),
  };
  assert.equal(toolData((await api.tool(first.token, 'call', call)).result).rpc_status, 'returned');
  const abandoned = await api.authorizeSession(scopes, first.agent_id);
  assert.equal(
    toolData((await api.tool(first.token, 'get_request', { request_id: call.request_id })).result)
      .rpc_status,
    'returned',
  );
  const latest = await api.authorizeSession(scopes, first.agent_id);
  const denied = await api.request('/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${abandoned.token}` },
  });
  assert.equal(denied.status, 401);
  await denied.text();
  // Token issuance/refresh alone does not activate the pending grant.
  const refreshed = await latest.refresh();
  assert.equal(typeof refreshed, 'string');
  assert.equal(
    toolData((await api.tool(first.token, 'get_request', { request_id: call.request_id })).result)
      .rpc_status,
    'returned',
  );
  assert.equal(
    toolData(
      (await api.tool(refreshed as string, 'get_request', { request_id: call.request_id })).result,
    ).error.code,
    'REQUEST_NOT_FOUND',
  );
  const old = await api.request('/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${first.token}` },
  });
  assert.equal(old.status, 401);
  await old.text();
  const next = { ...call, request_id: randomUUID() };
  assert.equal(
    toolData((await api.tool(refreshed as string, 'call', next)).result).rpc_status,
    'returned',
  );
  const again = await latest.refresh();
  assert.equal(typeof again, 'string');
  assert.equal(
    toolData(
      (await api.tool(again as string, 'get_request', { request_id: next.request_id })).result,
    ).rpc_status,
    'returned',
  );
  assert.equal(commands, 2, 'reauthorization must not replay native work');
  await api.admin(`/agents/${first.agent_id}/revoke`, 'POST');
  const revoked = await api.request('/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${again}` },
  });
  assert.equal(revoked.status, 401);
  await revoked.text();
});

test('MCP exposes wire incompatibility without allowing incompatible or stale candidates to take over', async (t) => {
  const api = await startServer(t),
    device = await api.enroll(),
    token = await api.authorize();
  await api.connect(device, { generation: 99, wire: WIRE_VERSION + 1 });
  let current = toolData((await api.tool(token, 'list_connections')).result).connections[0];
  assert.equal(current.diagnostic.code, 'DEVICE_PROTOCOL_MISMATCH');
  const unavailable = toolData(
    (
      await api.tool(token, 'describe_methods', {
        connection_id: device.input.device_id,
        interface: 'app_server',
      })
    ).result,
  );
  assert.equal(unavailable.error.code, 'DEVICE_PROTOCOL_MISMATCH');
  const { socket } = await api.connect(device, { generation: 1, version: '0.0.999' });
  const ack = once(socket, 'message');
  socket.send(JSON.stringify(heartbeat));
  await ack;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === 'command')
      socket.send(
        JSON.stringify({
          type: 'response',
          id: message.id,
          ok: true,
          result: { opaque: 'current-session' },
        }),
      );
  });
  await api.connect(device, { generation: 100, wire: WIRE_VERSION + 1 });
  await api.connect(device, { generation: 1, attempt: 1 });
  current = toolData((await api.tool(token, 'list_connections')).result).connections[0];
  assert.equal(current.availability, 'online');
  assert.equal(current.diagnostic, null);
  assert.equal(current.connector_version, '0.0.999');
  const result = toolData(
    (
      await api.tool(token, 'describe_methods', {
        connection_id: device.input.device_id,
        interface: 'app_server',
      })
    ).result,
  );
  assert.equal(result.opaque, 'current-session');
});

test('MCP requires fresh approval after device revocation with more than 100 pending applications', async (t) => {
  const api = await startServer(t);
  // Public enrollment only prepares fixtures; assertions cover MCP visibility and authority.
  for (let i = 0; i < 100; i++) await api.enroll(false);
  const device = await api.enroll(false),
    token = await api.authorize();
  const { socket } = await api.connect(device);
  assert.deepEqual(toolData((await api.tool(token, 'list_connections')).result).connections, []);
  const promoted = once(socket, 'message');
  await api.admin(`/device-requests/${device.input.operation_id}/approve`, 'POST');
  await promoted;
  const ack = once(socket, 'message');
  socket.send(JSON.stringify(heartbeat));
  await ack;
  assert.equal(toolData((await api.tool(token, 'list_connections')).result).connections.length, 1);
  await api.admin(`/devices/${device.input.device_id}/revoke`, 'POST');
  assert.deepEqual(toolData((await api.tool(token, 'list_connections')).result).connections, []);
  assert.equal(
    toolData(
      (
        await api.tool(token, 'describe_methods', {
          connection_id: device.input.device_id,
          interface: 'app_server',
        })
      ).result,
    ).error.code,
    'CONNECTION_NOT_AUTHORIZED',
  );

  const operation = randomUUID();
  const application = await api.request('/setup/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...device.input, operation_id: operation }),
  });
  assert.equal(application.status, 200, await application.text());
  const replacement = await api.connect(device, { attempt: 2 });
  assert.deepEqual(toolData((await api.tool(token, 'list_connections')).result).connections, []);
  assert.equal(
    toolData(
      (
        await api.tool(token, 'describe_methods', {
          connection_id: device.input.device_id,
          interface: 'app_server',
        })
      ).result,
    ).error.code,
    'CONNECTION_NOT_AUTHORIZED',
  );
  const reapproved = once(replacement.socket, 'message');
  await api.admin(`/device-requests/${operation}/approve`, 'POST');
  await reapproved;
  const ready = once(replacement.socket, 'message');
  replacement.socket.send(JSON.stringify(heartbeat));
  await ready;
  const connections = toolData((await api.tool(token, 'list_connections')).result).connections;
  assert.equal(connections.length, 1);
  assert.equal(connections[0].connection_id, device.input.device_id);
  replacement.socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === 'command')
      replacement.socket.send(
        JSON.stringify({
          type: 'response',
          id: message.id,
          ok: true,
          result: { opaque: 'same-device-after-fresh-approval' },
        }),
      );
  });
  assert.equal(
    toolData(
      (
        await api.tool(token, 'describe_methods', {
          connection_id: device.input.device_id,
          interface: 'app_server',
        })
      ).result,
    ).opaque,
    'same-device-after-fresh-approval',
  );
});
