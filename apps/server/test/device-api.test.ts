import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WIRE_VERSION } from '@dotx/shared/gateway';
import { startServer } from './support/server.ts';

test('MCP routes opaque device RPCs once, returns receipts and rejects stale runtimes', async (t) => {
  const api = await startServer(t);
  const device = await api.enroll();
  const token = await api.authorize();
  const response = await api.request('/device/connect', {
    headers: {
      Upgrade: 'websocket',
      'X-Device-Id': device.input.device_id,
      Authorization: `Bearer ${device.token}`,
    },
  });
  assert.equal(response.status, 101);
  const socket = response.webSocket!;
  socket.accept();
  t.after(() => socket.close());
  const ack = once(socket, 'message');
  socket.send(
    JSON.stringify({
      type: 'heartbeat',
      protocol: WIRE_VERSION,
      availability: 'online',
      interfaces: [{ name: 'app_server', runtime_id: 'test-runtime', availability: 'online' }],
    }),
  );
  assert.deepEqual(JSON.parse((await ack)[0].data), {
    type: 'heartbeat_ack',
    protocol: WIRE_VERSION,
  });
  const connections = (await api.tool(token, 'list_connections')).result.structuredContent
    .connections;
  assert.equal(connections[0].connection_id, device.input.device_id);
  assert.equal(connections[0].availability, 'online');

  // Only DotX's own wire envelope is simulated. This endpoint does not implement
  // Codex methods, thread states, permission settings or native event semantics.
  const commands: any[] = [];
  const native = { result: { arbitrary: ['opaque', 42] } };
  socket.addEventListener('message', (event) => {
    const command = JSON.parse(String(event.data));
    commands.push(command);
    socket.send(
      JSON.stringify({
        type: 'response',
        id: command.id,
        ok: true,
        result: { rpc_status: 'returned', native },
      }),
    );
  });
  const args = {
    connection_id: device.input.device_id,
    interface: 'app_server',
    runtime_id: 'test-runtime',
    request_id: randomUUID(),
    method: 'example/operation',
    params: { arbitrary: ['input', 7] },
  };
  const first = (await api.tool(token, 'call', args)).result.structuredContent;
  assert.equal(first.rpc_status, 'returned');
  assert.deepEqual(first.native, native);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].operation, 'call');
  assert.equal(commands[0].protocol, WIRE_VERSION);
  assert.equal(commands[0].args.method, args.method);
  assert.deepEqual(commands[0].args.params, args.params);

  const repeat = (await api.tool(token, 'call', args)).result.structuredContent;
  const receipt = (await api.tool(token, 'get_request', { request_id: args.request_id })).result
    .structuredContent;
  assert.equal(repeat.rpc_status, 'returned');
  assert.equal(receipt.rpc_status, 'returned');
  assert.equal(receipt.result_unavailable_reason, 'RPC_PAYLOAD_NOT_RETAINED');
  assert.equal(receipt.native, undefined);
  assert.equal(repeat.native, undefined);
  assert.equal(commands.length, 1);

  const errorCode = (reply: any) => {
    assert.equal(reply.result.isError, true);
    return JSON.parse(reply.result.content[0].text).error.code;
  };
  assert.equal(
    errorCode(await api.tool(token, 'call', { ...args, params: { different: true } })),
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(
    errorCode(await api.tool(token, 'get_request', { request_id: randomUUID() })),
    'REQUEST_NOT_FOUND',
  );
  const stale = (
    await api.tool(token, 'call', {
      ...args,
      request_id: randomUUID(),
      runtime_id: 'expired-runtime',
    })
  ).result.structuredContent;
  assert.equal(stale.rpc_status, 'rejected');
  assert.equal(stale.diagnostic.code, 'RUNTIME_CHANGED');
  assert.equal(commands.length, 1);
});
