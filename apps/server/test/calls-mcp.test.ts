import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WIRE_VERSION } from '@dotx/shared/gateway';
import { startServer, toolData } from './support/server.ts';

test('MCP routes opaque device RPCs once, returns receipts and rejects stale runtimes', async (t) => {
  const api = await startServer(t);
  const device = await api.enroll();
  const token = await api.authorize();
  const listing = (await api.rpc(token, 'tools/list')).result.tools;
  assert.equal(listing.length, 7);
  const callTool = listing.find((tool: any) => tool.name === 'call');
  assert(!callTool.inputSchema.required.includes('request_id'));
  assert.equal(callTool.annotations.idempotentHint, false);
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
  t.after(() => {
    if (socket.readyState === WebSocket.OPEN) socket.close();
  });
  const ack = once(socket, 'message');
  const heartbeat = {
    type: 'heartbeat',
    protocol: WIRE_VERSION,
    availability: 'online',
    interfaces: ['app_server', 'app_tools'].map((name) => ({
      name,
      runtime_id: 'test-runtime',
      availability: 'online',
    })),
  };
  socket.send(JSON.stringify(heartbeat));
  assert.deepEqual(JSON.parse((await ack)[0].data), {
    type: 'heartbeat_ack',
    protocol: WIRE_VERSION,
  });
  const connections = toolData((await api.tool(token, 'list_connections')).result).connections;
  assert.equal(connections[0].connection_id, device.input.device_id);
  assert.equal(connections[0].availability, 'online');

  // Protocol diagnostics belong to the Server, not the heartbeat payload.
  for (const protocol of [WIRE_VERSION + 1, WIRE_VERSION]) {
    const heartbeatAck = once(socket, 'message');
    socket.send(
      JSON.stringify({
        type: 'heartbeat',
        protocol,
        availability: 'online',
        interfaces: connections[0].interfaces,
      }),
    );
    assert.equal(JSON.parse((await heartbeatAck)[0].data).type, 'heartbeat_ack');
    const current = toolData((await api.tool(token, 'list_connections')).result).connections[0];
    assert.equal(current.availability, protocol === WIRE_VERSION ? 'online' : 'unavailable');
    assert.deepEqual(
      current.diagnostic,
      protocol === WIRE_VERSION ? null : { code: 'DEVICE_PROTOCOL_MISMATCH' },
    );
  }

  // Only DotX's own wire envelope is simulated. This endpoint does not implement
  // Codex methods, thread states, permission settings or native event semantics.
  const commands: any[] = [];
  let holdReply = false;
  const native = { result: { arbitrary: ['opaque', 42] } };
  socket.addEventListener('message', (event) => {
    const command = JSON.parse(String(event.data));
    if (command.type !== 'command') return;
    commands.push(command);
    if (holdReply) return;
    socket.send(
      JSON.stringify({
        type: 'response',
        id: command.id,
        ...(command.args.tracking === 'thread_turn'
          ? { ok: false, error: { code: 'TEST_DEVICE_FAILURE' } }
          : { ok: true, result: { rpc_status: 'returned', native } }),
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
  const first = toolData((await api.tool(token, 'call', args)).result);
  assert.equal(first.rpc_status, 'returned');
  assert.deepEqual(first.native, native);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].operation, 'call');
  assert.equal(commands[0].protocol, WIRE_VERSION);
  assert.equal(commands[0].args.method, args.method);
  assert.deepEqual(commands[0].args.params, args.params);

  const repeat = toolData((await api.tool(token, 'call', args)).result);
  const receipt = toolData(
    (await api.tool(token, 'get_request', { request_id: args.request_id })).result,
  );
  assert.equal(repeat.rpc_status, 'returned');
  assert.equal(receipt.rpc_status, 'returned');
  assert.equal(receipt.result_unavailable_reason, 'RPC_PAYLOAD_NOT_RETAINED');
  assert.equal(receipt.native, undefined);
  assert.equal(repeat.native, undefined);
  assert.equal(commands.length, 1);

  // Receipts belong to the service owner, not a particular OAuth grant.
  const anotherGrant = await api.authorize(['mcp:read']);
  assert.equal(
    toolData((await api.tool(anotherGrant, 'get_request', { request_id: args.request_id })).result)
      .rpc_status,
    'returned',
  );

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
  const stale = toolData(
    (
      await api.tool(token, 'call', {
        ...args,
        request_id: randomUUID(),
        runtime_id: 'expired-runtime',
      })
    ).result,
  );
  assert.equal(stale.rpc_status, 'rejected');
  assert.equal(stale.diagnostic.code, 'RUNTIME_CHANGED');
  assert.equal(commands.length, 1);

  // Verify the Server's forwarding contract, not native acceptance or turn execution.
  const tracked = {
    ...args,
    interface: 'app_tools',
    method: 'codex_app.send_message_to_thread',
    tracking: 'thread_turn',
    request_id: randomUUID(),
    params: {
      threadId: 'test-thread',
      prompt: 'Synthetic transport payload',
      extension: { values: [null, 7], enabled: true },
    },
  };
  const forwarded = toolData((await api.tool(token, 'call', tracked)).result);
  assert.equal(forwarded.diagnostic.code, 'TEST_DEVICE_FAILURE');
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1].args.params, tracked.params);
  assert.equal(commands[1].args.task.threadId, tracked.params.threadId);
  assert.equal(commands[1].args.task.hostId, 'local');
  assert.equal(
    errorCode(
      await api.tool(token, 'call', {
        ...tracked,
        params: { ...tracked.params, extension: { enabled: false } },
      }),
    ),
    'IDEMPOTENCY_CONFLICT',
  );
  const missingTarget = await api.tool(token, 'call', {
    ...tracked,
    request_id: randomUUID(),
    params: { prompt: tracked.params.prompt },
  });
  assert.equal(missingTarget.result.isError, true);
  assert.equal(commands.length, 2);

  // Preserve the distinction between an object, explicit null and no params field.
  const { params: _params, ...withoutParams } = args;
  for (const form of [{ params: {} }, { params: null }, {}]) {
    const input = { ...withoutParams, request_id: randomUUID(), ...form };
    const reply = (await api.tool(token, 'call', input)).result;
    assert.equal(toolData(reply)?.rpc_status, 'returned', JSON.stringify(reply));
    const forwarded = commands.at(-1).args;
    assert.equal(Object.hasOwn(forwarded, 'params'), Object.hasOwn(form, 'params'));
    assert.deepEqual(forwarded.params, 'params' in form ? form.params : undefined);
  }
  assert.equal(
    errorCode(
      await api.tool(token, 'call', {
        ...withoutParams,
        request_id: commands.at(-1).args.request_id,
        params: null,
      }),
    ),
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(commands.length, 5);

  // No request_id means a new RPC each time, with no persistent receipt.
  const { request_id: _requestId, ...direct } = args;
  const replies = await Promise.all([
    api.tool(token, 'call', direct),
    api.tool(token, 'call', direct),
  ]);
  for (const reply of replies)
    assert.deepEqual(toolData(reply.result), { rpc_status: 'returned', native });
  assert.equal(commands.length, 7);
  assert.notEqual(commands[5].id, commands[6].id);
  for (const command of commands.slice(5)) {
    assert.equal(Object.hasOwn(command.args, 'request_id'), false);
    assert.equal(
      errorCode(await api.tool(token, 'get_request', { request_id: command.id })),
      'REQUEST_NOT_FOUND',
    );
  }
  const { request_id: _trackedId, ...unidentifiedTurn } = tracked;
  assert.equal(errorCode(await api.tool(token, 'call', unidentifiedTurn)), 'REQUEST_ID_REQUIRED');
  assert.equal(commands.length, 7, 'missing ID must fail before a tracked send');

  holdReply = true;
  const interrupted = { ...args, request_id: randomUUID() };
  const dispatched = once(socket, 'message');
  const pending = api.tool(token, 'call', interrupted);
  await dispatched;
  const replacementResponse = await api.request('/device/connect', {
    headers: {
      Upgrade: 'websocket',
      'X-Device-Id': device.input.device_id,
      Authorization: `Bearer ${device.token}`,
    },
  });
  const replacement = replacementResponse.webSocket!;
  replacement.accept();
  t.after(() => replacement.close());
  let replacementCalls = 0;
  replacement.addEventListener('message', (event) => {
    const command = JSON.parse(String(event.data));
    if (command.type !== 'command') return;
    replacementCalls++;
    replacement.send(
      JSON.stringify({
        type: 'response',
        id: command.id,
        ok: true,
        result: { rpc_status: 'returned', native },
      }),
    );
  });
  const selectedRuntime = async () =>
    toolData((await api.tool(token, 'list_connections')).result).connections[0].interfaces[0]
      .runtime_id;
  assert.equal(await selectedRuntime(), 'test-runtime', 'wait for the new connector to be ready');
  const ready = once(replacement, 'message');
  replacement.send(
    JSON.stringify({
      ...heartbeat,
      interfaces: heartbeat.interfaces.map((entry) => ({ ...entry, runtime_id: 'replacement' })),
    }),
  );
  socket.send(JSON.stringify(heartbeat)); // A queued old heartbeat must not reclaim the route.
  await ready;
  assert.equal(await selectedRuntime(), 'replacement');
  const lost = toolData((await pending).result);
  assert.equal(lost.rpc_status, 'unknown');
  assert.equal(lost.diagnostic.code, 'CONNECTION_LOST_OUTCOME_UNKNOWN');
  assert.equal(lost.diagnostic.cause.code, 'CONNECTION_REPLACED');
  const pendingReceipt = toolData(
    (await api.tool(token, 'get_request', { request_id: interrupted.request_id })).result,
  );
  assert.equal(pendingReceipt.rpc_status, 'unknown');
  assert.equal(toolData((await api.tool(token, 'call', interrupted)).result).rpc_status, 'unknown');
  assert.equal(commands.length, 8);
  assert.equal(errorCode(await api.tool(token, 'call', direct)), 'RUNTIME_CHANGED');
  assert.equal(replacementCalls, 0, 'handoff must not resend an in-flight RPC');
  assert.deepEqual(
    toolData((await api.tool(token, 'call', { ...direct, runtime_id: 'replacement' })).result)
      .native,
    native,
  );
  assert.equal(replacementCalls, 1);
});
