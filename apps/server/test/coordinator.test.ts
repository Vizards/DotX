import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinator } from './fixtures/coordinator.ts';
import { MemoryStore } from './fixtures/store.ts';
import type { DeviceOperation } from '@dotx/shared/state';
import type { Outcome } from '@dotx/shared/protocol';
const auth = { principal: 'owner', devices: ['mini', 'book'] };
const args = {
  connection_id: 'mini',
  interface: 'app_server',
  runtime_id: 'runtime-a',
  request_id: 'request-a',
  method: 'thread/start',
  params: { nested: { a: 1, b: 2 } },
};
test('cloud atomic reservation deduplicates concurrent calls, survives reconstruction, fingerprints nested params', async () => {
  const store = new MemoryStore();
  let calls = 0;
  const dispatch = async (op: DeviceOperation): Promise<Outcome> => {
    if (op === 'call') calls++;
    return { ok: true, result: { rpc_status: 'returned', native: { result: 'raw-only' } } };
  };
  const router = coordinator(dispatch, store).cloud;
  await Promise.all(Array.from({ length: 20 }, () => router.invoke(auth, 'call', args)));
  assert.equal(calls, 1);
  await coordinator(dispatch, store).cloud.invoke(auth, 'call', {
    ...args,
    params: { nested: { b: 2, a: 1 } },
  });
  assert.equal(calls, 1);
  for (const patch of [
    { connection_id: 'book' },
    { params: { nested: { a: 2, b: 2 } } },
    { runtime_id: 'runtime-b' },
  ])
    await assert.rejects(router.invoke(auth, 'call', { ...args, ...patch }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
  assert(!JSON.stringify([...store.data.values()]).includes('nested'));
});
test('unknown and offline do not permit replay; request route requires authority', async () => {
  const store = new MemoryStore();
  let calls = 0;
  const router = coordinator(async (op) => {
    if (op === 'call') calls++;
    return { ok: false, error: { code: 'CONNECTION_LOST_OUTCOME_UNKNOWN' } };
  }, store).cloud;
  const first = (await router.invoke(auth, 'call', args)) as { rpc_status: string };
  assert.equal(first.rpc_status, 'unknown');
  await router.invoke(auth, 'call', args);
  assert.equal(calls, 1);
  await assert.rejects(
    router.invoke({ ...auth, devices: ['book'] }, 'get_request', { request_id: args.request_id }),
    { code: 'CONNECTION_NOT_AUTHORIZED' },
  );
});
test('reverse responses route from authenticated observed event, not caller supplied target', async () => {
  const store = new MemoryStore();
  const commands: { op: string; args: Record<string, unknown> }[] = [];
  const router = coordinator(async (op, a) => {
    commands.push({ op, args: a });
    return {
      ok: true,
      result:
        op === 'read_events'
          ? {
              events: [
                {
                  event_id: 'event-a',
                  connection_id: 'mini',
                  interface: 'app_server',
                  runtime_id: 'runtime-a',
                  kind: 'server_request',
                  native: { id: 7 },
                },
              ],
            }
          : { response_status: 'submitted' },
    };
  }, store).cloud;
  await assert.rejects(
    router.invoke(auth, 'respond', {
      event_id: 'event-a',
      response: { result: { decision: 'decline' } },
    }),
    { code: 'EVENT_NOT_FOUND' },
  );
  await router.invoke(auth, 'read_events', {
    connection_id: 'mini',
    interface: 'app_server',
    runtime_id: 'runtime-a',
  });
  await router.invoke(auth, 'respond', {
    event_id: 'event-a',
    response: { result: { decision: 'decline' } },
  });
  assert.equal(commands.at(-1)?.args.connection_id, 'mini');
  assert.equal(commands.at(-1)?.args.runtime_id, 'runtime-a');
  await assert.rejects(
    router.invoke({ principal: 'other', devices: ['mini'] }, 'respond', {
      event_id: 'event-a',
      response: { result: {} },
    }),
    { code: 'EVENT_NOT_FOUND' },
  );
});

test('lost DO in-flight state becomes unknown; a different runtime cannot forge a late receipt', async () => {
  const store = new MemoryStore();
  let release!: (value: Outcome) => void, entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const first = coordinator(async () => {
    entered();
    return new Promise<Outcome>((r) => {
      release = r;
    });
  }, store).cloud;
  const pending = first.invoke(auth, 'call', args);
  await started;
  const restored = coordinator(async () => {
    throw Error('must not dispatch again');
  }, store).cloud;
  assert.equal(
    (await restored.invoke(auth, 'get_request', { request_id: args.request_id })).rpc_status,
    'unknown',
  );
  const id = [...store.data.keys()]
    .find((k) => k.startsWith('state:call:'))!
    .slice('state:call:'.length);
  const reply: Outcome = {
    ok: true,
    result: { rpc_status: 'returned', native: { result: 'secret' } },
  };
  await assert.rejects(
    restored.recordReply(id, reply, { connection: 'mini', runtimes: ['other-runtime'] }),
    { code: 'REPLY_SOURCE_MISMATCH' },
  );
  release(reply);
  await pending;
  assert.equal(
    (await restored.invoke(auth, 'get_request', { request_id: args.request_id })).rpc_status,
    'returned',
  );
  assert(!JSON.stringify([...store.data.values()]).includes('secret'));
});
