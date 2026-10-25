import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import { startServer, toolData } from '../support/server.ts';
import { MCP_PROTOCOL_VERSION } from '../../src/mcp/protocol.ts';

test('MCP uses SDK request limits and forwards larger device responses', async (t) => {
  const api = await startServer(t);
  const device = await api.enroll();
  const token = await api.authorize();
  const { socket } = await api.connect(device);
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
  const input = 'y'.repeat(2 * 1024 * 1024);
  let commands = 0;
  socket.addEventListener('message', (event) => {
    const command = JSON.parse(String(event.data));
    if (command.type !== 'command') return;
    commands++;
    assert.equal(command.args.params.opaque, input);
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
      params: { opaque: input },
    });
    assert.equal(toolData(reply.result).rpc_status, 'returned');
    assert.equal(toolData(reply.result).native.result.opaque, value);
    assert.equal(Object.hasOwn(reply.result, 'structuredContent'), false);
  }
  const oversized = await api.request('/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'oversized',
      method: 'tools/call',
      params: {
        name: 'call',
        arguments: {
          connection_id: device.input.device_id,
          interface: 'app_server',
          runtime_id: 'payload-test',
          method: 'example/opaque',
          params: { opaque: 'z'.repeat(5 * 1024 * 1024) },
        },
      },
    }),
  });
  assert.equal(oversized.status, 413);
  await oversized.text();
  assert.equal(commands, 2);
});
