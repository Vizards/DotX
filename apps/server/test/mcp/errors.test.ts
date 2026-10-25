import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import { startServer, toolData } from '../support/server.ts';

test('MCP tools preserve opaque failures and avoid resubmitting an answer', async (t) => {
  const api = await startServer(t);
  const device = await api.enroll();
  const token = await api.authorize();
  const opaque = {
    code: 47,
    message: 'Synthetic peer failure',
    data: { values: [null, 2], cause: { message: 'Opaque detail' } },
    extra: true,
  };
  // Simulate DotX protocol envelopes only. The peer does not implement native methods,
  // turns or approvals; opaque values test the Server's transport and receipt contracts.
  let handle: (command: any) => object | Promise<object> = () => ({
    ok: false,
    error: opaque,
  });
  const commands: any[] = [];
  const { socket } = await api.connect(device);
  const ack = once(socket, 'message');
  socket.send(
    JSON.stringify({
      type: 'heartbeat',
      protocol: WIRE_VERSION,
      availability: 'online',
      interfaces: ['app_server', 'app_tools', 'client_coordination'].map((name) => ({
        name,
        runtime_id: 'peer-runtime',
        availability: 'online',
      })),
    }),
  );
  assert.equal(JSON.parse((await ack)[0].data).type, 'heartbeat_ack');
  socket.addEventListener('message', async (event) => {
    const command = JSON.parse(String(event.data));
    commands.push(command);
    socket.send(JSON.stringify({ type: 'response', id: command.id, ...(await handle(command)) }));
  });
  const tool = async (name: string, args: Record<string, unknown> = {}) =>
    (await api.tool(token, name, args)).result;
  const address = {
    connection_id: device.input.device_id,
    interface: 'app_server',
    runtime_id: 'peer-runtime',
  };
  const described = await tool('describe_methods', {
    connection_id: address.connection_id,
    interface: address.interface,
  });
  assert(described.isError);
  assert.deepEqual(JSON.parse(described.content[0].text).error, opaque);
  const base = { ...address, request_id: randomUUID(), method: 'example/operation', params: {} };
  assert.deepEqual(toolData(await tool('call', base)).diagnostic, opaque);
  assert.deepEqual(
    toolData(await tool('get_request', { request_id: base.request_id })).diagnostic,
    opaque,
  );
  const { request_id: _requestId, ...direct } = base;
  const directFailure = await tool('call', direct);
  assert.equal(directFailure.isError, true);
  assert.deepEqual(JSON.parse(directFailure.content[0].text).error, opaque);

  handle = () => ({
    ok: true,
    result: { rpc_status: 'error', native: { error: 'opaque-string' } },
  });
  assert.deepEqual(toolData(await tool('call', { ...base, request_id: randomUUID() })).native, {
    error: 'opaque-string',
  });
  assert.deepEqual(toolData(await tool('call', direct)), {
    rpc_status: 'error',
    native: { error: 'opaque-string' },
  });

  const event = {
    event_id: 'transport-event',
    ...address,
    sequence: 1,
    created_at: Date.now(),
    kind: 'server_request',
    native: { id: 'first-opaque-request', arbitrary: 'opaque' },
    response_status: 'pending',
    response_diagnostic: opaque,
  };
  handle = (command) =>
    command.operation === 'read_events'
      ? { ok: true, result: { events: [event] } }
      : { ok: true, result: { response_status: 'unknown', diagnostic: 'native-rejection-text' } };
  const eventsArgs = { ...address };
  await tool('read_events', eventsArgs);
  const answer = { event_id: event.event_id, response: { result: { arbitrary: true } } };
  assert.equal(toolData(await tool('respond', answer)).diagnostic, 'native-rejection-text');
  assert.equal(
    toolData(await tool('read_events', eventsArgs)).events[0].response_diagnostic,
    'native-rejection-text',
  );
  await tool('respond', answer);
  assert.equal(commands.filter((c) => c.operation === 'respond').length, 1);
});
