import test from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../src/gateway/dispatcher.ts';
import { EventBuffer } from '../src/events/buffer.ts';
import { Observations } from '../src/relay/observations.ts';
import type { TurnTracker } from '../src/tracking/tracker.ts';
import type { Adapter } from '../src/interfaces/adapter.ts';
const input = {
  connection_id: 'mini',
  interface: 'app_server' as const,
  runtime_id: 'runtime-a',
  request_id: 'request-a',
  method: 'native/write',
  params: { nested: { a: 1 } },
};
function fixture() {
  const events = new EventBuffer();
  events.registerRuntime(input.runtime_id);
  const adapter: Adapter = {
    status: () => ({ name: input.interface, runtime_id: input.runtime_id, availability: 'online' }),
    methods: async () => [{ name: input.method, kind: 'request', input_schema: {} }],
    call: async (_method, params) => ({ result: { echo: params } }),
    close() {},
  };
  return {
    events,
    adapter,
    gateway: new Gateway({
      resolveTurn: async () => null,
      connectionId: 'mini',
      events,
      tracker: {} as TurnTracker,
      adapters: new Map([[input.interface, adapter]]),
    }),
  };
}
test('desktop gateway returns native responses directly, with no local call ledger', async () => {
  const f = fixture();
  const r = await f.gateway.execute('call', input);
  assert.deepEqual(r, { rpc_status: 'returned', native: { result: { echo: input.params } } });
  f.adapter.call = async () => ({ error: { code: -32600, message: 'raw', data: ['unchanged'] } });
  assert.deepEqual((await f.gateway.execute('call', input)).native.error.data, ['unchanged']);
  f.adapter.call = async () => {
    throw Error('lost');
  };
  assert.equal((await f.gateway.execute('call', input)).rpc_status, 'unknown');
  assert.equal(f.events.rows.length, 0);
});
test('stale runtime and managed lifecycle fail before native dispatch', async () => {
  const f = fixture();
  let count = 0;
  f.adapter.call = async () => {
    count++;
    return { result: null };
  };
  await assert.rejects(f.gateway.execute('call', { ...input, runtime_id: 'stale' }), {
    code: 'RUNTIME_CHANGED',
  });
  f.adapter.methods = async () => [
    { name: input.method, kind: 'request', managed: true, input_schema: {} },
  ];
  await assert.rejects(f.gateway.execute('call', input), { code: 'PROTOCOL_LIFECYCLE_MANAGED' });
  assert.equal(count, 0);
});
test('bounded native event memory reports pagination, gaps and expired handles explicitly', () => {
  const queue = new Observations();
  const events = new EventBuffer((e) => queue.native(e), 2);
  events.registerRuntime('a');
  events.registerRuntime('b');
  const event = () =>
    events.addEvent({
      connection_id: 'mini',
      interface: 'app_server',
      runtime_id: 'a',
      kind: 'server_request',
      native: { id: 1, method: 'approval', params: { private: 'body' } },
      response_status: 'pending',
    });
  const first = event();
  event();
  const page = events.events('a', undefined, 1);
  assert.equal(page.has_more, true);
  assert.throws(() => events.events('b', page.next_cursor, 1), { code: 'CURSOR_RUNTIME_MISMATCH' });
  event();
  assert.equal(events.events('a', undefined, 10).gap, true);
  assert.equal(events.event(first.event_id), null);
  assert(!JSON.stringify(queue.pending()).includes('private'));
  events.expireRuntime('a');
  assert.throws(() => events.events('a', undefined, 10), { code: 'EVENT_RUNTIME_EXPIRED' });
  const restarted = new EventBuffer();
  assert.throws(() => restarted.events('a', undefined, 10), { code: 'EVENT_RUNTIME_EXPIRED' });
  assert.equal(
    new Observations().pending().length,
    0,
    'unuploaded notices are explicitly process-local',
  );
});

test('re-observing the same native status after upload keeps a stable event ID and payload', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const q = new Observations(),
    buffer = new EventBuffer((e) => q.native(e));
  const event = buffer.addEvent({
    connection_id: 'mini',
    interface: 'client_coordination',
    runtime_id: 'r',
    kind: 'server_request',
    interaction_key: 'logical',
    response_status: 'pending',
    native: { id: 7, method: 'approval' },
  });
  const before = structuredClone(q.pending()[0]);
  q.ack([before.id]);
  t.mock.timers.tick(5000);
  q.native(event);
  assert.deepEqual(q.pending(), [before]);
  buffer.responseState(event.event_id, 'resolved');
  assert.equal(q.pending().length, 2);
  assert.notEqual(q.pending()[1].id, before.id);
});
