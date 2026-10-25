import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import { startServer, toolData } from '../support/server.ts';

async function peer(api: Awaited<ReturnType<typeof startServer>>) {
  const device = await api.enroll();
  const { socket } = await api.connect(device);
  const address = {
    connection_id: device.input.device_id,
    interface: 'app_server',
    runtime_id: 'opaque-runtime',
  };
  const ack = once(socket, 'message');
  socket.send(
    JSON.stringify({
      type: 'heartbeat',
      protocol: WIRE_VERSION,
      availability: 'online',
      interfaces: [
        { name: address.interface, runtime_id: address.runtime_id, availability: 'online' },
      ],
    }),
  );
  await ack;
  const event = {
    ...address,
    event_id: 'opaque-event',
    sequence: 1,
    created_at: Date.now(),
    kind: 'server_request',
    native: { id: 'opaque-handle' },
    response_status: 'pending',
  };
  const commands: any[] = [];
  let release: (() => void) | undefined;
  socket.addEventListener('message', async (message) => {
    const command = JSON.parse(String(message.data));
    if (command.type !== 'command') return;
    commands.push(command);
    if (command.args.params?.hold)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    // Only DotX wire envelopes and opaque responses; no native host is simulated.
    const result =
      command.operation === 'read_events'
        ? { events: [event] }
        : command.operation === 'respond'
          ? { response_status: 'submitted' }
          : { rpc_status: 'returned', native: { result: { opaque: true } } };
    socket.send(JSON.stringify({ type: 'response', id: command.id, ok: true, result }));
  });
  return { address, event, commands, socket, release: () => release!() };
}
async function missing(
  api: Awaited<ReturnType<typeof startServer>>,
  token: string,
  requestId: string,
) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const result = toolData(
      (await api.tool(token, 'get_request', { request_id: requestId })).result,
    );
    if (result.error?.code === 'REQUEST_NOT_FOUND') return;
    assert(Date.now() < deadline, 'expired receipt must be removed by the alarm');
    await delay(50);
  }
}

test('MCP receipts and shared answers expire without renewing on reads or retries', async (t) => {
  const api = await startServer(t, 'list', { retentionDays: String(3000 / 86_400_000) });
  const p = await peer(api),
    token = await api.authorize(),
    other = await api.authorize();
  const input = { ...p.address, request_id: randomUUID(), method: 'opaque/call', params: {} };
  const first = toolData((await api.tool(token, 'call', input)).result);
  assert.equal(first.expires_at - first.created_at, 3000);
  await delay(50);
  const repeat = toolData((await api.tool(token, 'call', input)).result);
  assert.equal(repeat.expires_at, first.expires_at);
  assert.equal(p.commands.filter((c) => c.operation === 'call').length, 1);
  await api.tool(token, 'read_events', p.address);
  await api.tool(other, 'read_events', p.address);
  const answer = { event_id: p.event.event_id, response: { result: { opaque: true } } };
  const answered = toolData((await api.tool(token, 'respond', answer)).result);
  await delay(50);
  await api.tool(other, 'read_events', p.address);
  assert.equal(
    toolData((await api.tool(other, 'respond', answer)).result).expires_at,
    answered.expires_at,
  );
  assert.equal(p.commands.filter((c) => c.operation === 'respond').length, 1);
  await delay(Math.max(first.expires_at, answered.expires_at) - Date.now() + 150);
  await missing(api, token, input.request_id);
  // Delayed DotX responses/observations must not recreate an expired receipt.
  const oldId = p.commands.find((c) => c.operation === 'call').id;
  p.socket.send(
    JSON.stringify({ type: 'response', id: oldId, ok: true, result: { rpc_status: 'returned' } }),
  );
  const observed = once(p.socket, 'message');
  p.socket.send(
    JSON.stringify({
      type: 'observations',
      protocol: WIRE_VERSION,
      observations: [
        { id: 'late-observation', kind: 'turn', task_id: oldId, state: 'completed', turnId: null },
      ],
    }),
  );
  assert.equal(JSON.parse((await observed)[0].data).type, 'observations_ack');
  await missing(api, token, input.request_id);
  for (const current of [token, other])
    assert.equal(
      toolData((await api.tool(current, 'respond', answer)).result).error.code,
      'EVENT_NOT_FOUND',
    );
  const state = toolData((await api.tool(token, 'list_connections')).result);
  assert.equal(state.connections.length, 1, 'cleanup preserves device and agent authorization');
  assert.equal(state.record_retention_days, 3000 / 86_400_000);
  const again = toolData((await api.tool(token, 'call', input)).result);
  assert(again.created_at > first.created_at);
  assert.equal(
    p.commands.filter((c) => c.operation === 'call').length,
    2,
    'deduplication ends after cleanup',
  );
  await api.tool(token, 'read_events', p.address);
  assert.equal(
    toolData((await api.tool(token, 'respond', answer)).result).response_status,
    'submitted',
  );
  assert.equal(p.commands.filter((c) => c.operation === 'respond').length, 2);
});

test('MCP returns an in-flight result before cleaning its expired receipt', async (t) => {
  const api = await startServer(t, 'list', { retentionDays: String(1000 / 86_400_000) });
  const p = await peer(api),
    token = await api.authorize();
  const input = {
    ...p.address,
    request_id: randomUUID(),
    method: 'opaque/call',
    params: { hold: true },
  };
  const dispatched = once(p.socket, 'message');
  const pending = api.tool(token, 'call', input);
  await dispatched;
  await delay(1200);
  const receipt = toolData(
    (await api.tool(token, 'get_request', { request_id: input.request_id })).result,
  );
  assert.equal(receipt.rpc_status, 'pending');
  assert(receipt.expires_at <= Date.now());
  p.release();
  assert.deepEqual(toolData((await pending).result).native, { result: { opaque: true } });
  await missing(api, token, input.request_id);
  assert.equal(p.commands.length, 1);
});

test('MCP reports the default and applies changed retention to existing records', async (t) => {
  const api = await startServer(t);
  const p = await peer(api),
    token = await api.authorize();
  assert.equal(
    toolData((await api.tool(token, 'list_connections')).result).record_retention_days,
    30,
  );
  const input = { ...p.address, request_id: randomUUID(), method: 'opaque/call', params: {} };
  const receipt = toolData((await api.tool(token, 'call', input)).result);
  assert.equal(receipt.expires_at - receipt.created_at, 30 * 86_400_000);
  for (const days of [1, 60]) {
    await api.reload({ retentionDays: String(days) });
    const current = toolData(
      (await api.tool(token, 'get_request', { request_id: input.request_id })).result,
    );
    assert.equal(current.expires_at, receipt.created_at + days * 86_400_000);
  }
  await api.reload({ retentionDays: String(1 / 86_400_000) });
  await missing(api, token, input.request_id);
  await api.reload({ retentionDays: '60' });
  assert.equal(
    toolData((await api.tool(token, 'get_request', { request_id: input.request_id })).result).error
      .code,
    'REQUEST_NOT_FOUND',
  );
  assert.equal(toolData((await api.tool(token, 'list_connections')).result).connections.length, 1);
});

test('MCP receipts are cleaned across alarm batches without a record count limit', async (t) => {
  const api = await startServer(t);
  const p = await peer(api),
    token = await api.authorize();
  const ids = Array.from({ length: 105 }, () => randomUUID());
  for (const request_id of ids) {
    const result = toolData(
      (await api.tool(token, 'call', { ...p.address, request_id, method: 'opaque/call' })).result,
    );
    assert.equal(result.rpc_status, 'returned');
  }
  await api.reload({ retentionDays: String(1 / 86_400_000) });
  await Promise.all(ids.map((id) => missing(api, token, id)));
  assert.equal(toolData((await api.tool(token, 'list_connections')).result).connections.length, 1);
});
