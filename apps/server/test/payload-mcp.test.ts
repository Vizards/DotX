import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WIRE_VERSION } from '@dotx/shared/gateway';
import { startServer, toolData } from './support/server.ts';

test('MCP forwards device responses above 4 MiB without dropping the connection', async (t) => {
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
      interfaces: [{ name: 'app_server', runtime_id: 'payload-test', availability: 'online' }],
    }),
  );
  await ack;

  // Only DotX's opaque device-response envelope is simulated, not a Codex method.
  let payload = 'x'.repeat(5 * 1024 * 1024);
  let commands = 0;
  socket.addEventListener('message', (event) => {
    const command = JSON.parse(String(event.data));
    if (command.type !== 'command') return;
    commands++;
    socket.send(
      JSON.stringify({
        type: 'response',
        id: command.id,
        ok: true,
        result: { rpc_status: 'returned', native: { result: { opaque: payload } } },
      }),
    );
  });
  for (const value of [payload, 'still connected']) {
    payload = value;
    const reply = await api.tool(token, 'call', {
      connection_id: device.input.device_id,
      interface: 'app_server',
      runtime_id: 'payload-test',
      method: 'example/opaque',
      params: {},
    });
    assert.equal(toolData(reply.result).rpc_status, 'returned');
    assert.equal(toolData(reply.result).native.result.opaque, value);
    assert.equal(Object.hasOwn(reply.result, 'structuredContent'), false);
  }
  assert.equal(commands, 2);
});
