import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnTracker } from '../apps/desktop/src/tracking/tracker.ts';
import { coordinator, auth } from '../apps/server/test/fixtures/coordinator.ts';
import { nativeFixture, params } from '../apps/desktop/test/fixtures/native.ts';
import type { TrackedTask } from '@dotx/shared/state';
const args = {
  connection_id: 'mini',
  interface: 'app_tools',
  runtime_id: 'runtime-a',
  request_id: 'crash-request',
  method: 'codex_app.send_message_to_thread',
  params,
  tracking: 'thread_turn',
};
test('completion and minimal notification commit atomically; stale reports cannot regress or bind another turn', async () => {
  const f = coordinator(async () => ({
    ok: true,
    result: {
      rpc_status: 'returned',
      observation: { task_id: id, state: 'accepted', turnId: null },
    },
  }));
  let id = '';
  // Observe the saved intent inside dispatch; no native effect or private prompt is stored.
  const cloud = coordinator(async (_op, a) => {
    id = (a.task as TrackedTask).id;
    return {
      ok: true,
      result: {
        rpc_status: 'returned',
        observation: { task_id: id, state: 'accepted', turnId: null },
      },
    };
  }, f.store).cloud;
  await cloud.invoke(auth, 'call', args);
  const observe = (state: 'completed' | 'running', turnId = 'exact') =>
    cloud.observe('mini', [{ id: crypto.randomUUID(), kind: 'turn', task_id: id, state, turnId }]);
  const put = f.store.put.bind(f.store);
  f.store.put = async (key, value) => {
    if (key.startsWith('events:history:')) throw Error('disk failure');
    return put(key, value);
  };
  await assert.rejects(observe('completed'), /disk failure/);
  assert.equal((await cloud.restore('mini')).tasks[0].state, 'accepted');
  f.store.put = put;
  await observe('completed');
  const count = (await f.store.list({ prefix: 'events:history:' })).size;
  await observe('running');
  assert.equal((await cloud.restore('mini')).tasks.length, 0);
  assert.equal((await f.store.list({ prefix: 'events:history:' })).size, count);
  await assert.rejects(observe('running', 'unrelated'), { code: 'TURN_ID_CONFLICT' });
});
test('follow intents restore observation only; settings and prompt payloads are not persisted', async () => {
  const f = coordinator(async () => ({
    ok: true,
    result: { rpc_status: 'returned', native: { result: { secretBody: true } } },
  }));
  const a = {
    ...args,
    interface: 'client_coordination',
    tracking: 'native',
    method: 'thread-follower-update-thread-settings',
    params: {
      conversationId: 'target',
      threadSettings: { serviceTier: 'priority', permissions: ':danger-full-access' },
    },
  };
  await f.cloud.invoke(auth, 'call', a);
  assert.deepEqual((await f.cloud.restore('mini')).follows, [
    { hostId: 'local', conversationId: 'target' },
  ]);
  assert(
    !/secretBody|danger-full-access|priority/.test(JSON.stringify([...f.store.data.values()])),
  );
  await f.cloud.invoke(auth, 'call', {
    ...a,
    request_id: 'unfollow',
    method: 'thread-stream-following-changed',
    params: { conversationId: 'target', following: false },
  });
  assert.deepEqual((await f.cloud.restore('mini')).follows, []);
});

test('concurrent tracked sends share only cloud state; exact result is native and unknown does not lock the target', async () => {
  const f = nativeFixture();
  const tracker = new TurnTracker(f.native, 'caller', () => {}, f.resolveTurn);
  let offline = false;
  const { cloud, store } = coordinator(async (op, a) => {
    if (offline) return { ok: false, error: { code: 'DEVICE_OFFLINE' } };
    if (op === 'read_turn')
      return { ok: true, result: await tracker.inspect(a.task as TrackedTask) };
    const observation = await tracker.send(
      a.task as TrackedTask,
      a.params as Record<string, unknown>,
    );
    return { ok: true, result: { rpc_status: 'returned', observation } };
  });
  const input = { ...args, params: { ...params, model: 'selected-model', thinking: 'high' } };
  await Promise.all(Array.from({ length: 12 }, () => cloud.invoke(auth, 'call', input)));
  assert.equal(f.state.calls, 1);
  assert.equal(f.state.lastSend!.model, 'selected-model');
  f.state.turns[0].status = 'completed';
  f.state.turns[0].items.push({ type: 'agentMessage', text: 'PRIVATE_FINAL_BODY' });
  const completed = await cloud.invoke(auth, 'get_request', { request_id: input.request_id });
  assert.equal(completed.operation.state, 'completed');
  assert.equal(completed.operation.result.items[0].text, 'PRIVATE_FINAL_BODY');
  assert(!JSON.stringify([...store.data.values()]).includes('PRIVATE_FINAL_BODY'));
  offline = true;
  const missingBody = await cloud.invoke(auth, 'get_request', { request_id: input.request_id });
  assert.equal(missingBody.operation.state, 'completed');
  assert.equal(missingBody.result_available, false);
  offline = false;
  f.state.dropInput = true;
  f.state.loseResponse = true;
  await cloud.invoke(auth, 'call', { ...input, request_id: 'unknown-task' });
  await cloud.invoke(auth, 'call', { ...input, request_id: 'explicit-new-task' });
  assert.equal(
    f.state.calls,
    3,
    'a distinct explicit request is not blocked by a permanent per-target lock',
  );
  await assert.rejects(
    cloud.invoke(auth, 'call', { ...input, params: { ...input.params, thinking: 'low' } }),
    { code: 'IDEMPOTENCY_CONFLICT' },
  );
});

test('cross-host attribution uses authorized connectors, restores after lost response, and never sends again', async () => {
  const store = coordinator(async () => ({ ok: false, error: { code: 'unused' } })).store;
  let sends = 0,
    available = false;
  const lookedUp: string[] = [];
  const dispatch: import('../apps/server/src/state/coordinator.ts').Dispatch = async (op, a) => {
    if (op === 'call') {
      sends++;
      return { ok: false, error: { code: 'CALL_OUTCOME_UNKNOWN' } };
    }
    if (op === 'resolve_turn') {
      lookedUp.push(String(a.connection_id));
      assert.deepEqual(Object.keys(a.task as object).sort(), ['id', 'threadId']);
      return {
        ok: true,
        result: { turnId: available && a.connection_id === 'book' ? 'exact-remote' : null },
      };
    }
    assert.equal(op, 'read_turn');
    assert.equal(a.connection_id, 'mini');
    const t = a.task as TrackedTask;
    return {
      ok: true,
      result: {
        observation: { task_id: t.id, turnId: t.turnId, state: t.turnId ? 'completed' : 'unknown' },
        ...(t.turnId ? { result: { text: 'native-only' } } : {}),
      },
    };
  };
  const input = { ...args, params: { ...params, hostId: 'remote-control:book' } };
  await coordinator(dispatch, store).cloud.invoke(auth, 'call', input);
  const restarted = coordinator(dispatch, store).cloud;
  assert.equal((await restarted.restore('mini')).tasks[0].turnId, null);
  available = true;
  assert.equal((await restarted.restore('mini')).tasks[0].turnId, 'exact-remote');
  const completed = await restarted.invoke(auth, 'get_request', { request_id: input.request_id });
  assert.equal(completed.operation.state, 'completed');
  assert.equal(completed.operation.result.text, 'native-only');
  await restarted.invoke(auth, 'call', input);
  assert.equal(sends, 1);
  assert.deepEqual(new Set(lookedUp), new Set(['mini', 'book']));
  assert(!JSON.stringify([...store.data.values()]).includes('native-only'));
});

test('conflicting hidden attributions never select the latest or first result', async () => {
  const f = coordinator(async (op, a) => {
    if (op === 'resolve_turn')
      return { ok: true, result: { turnId: String(a.connection_id) + '-turn' } };
    return { ok: false, error: { code: 'CALL_OUTCOME_UNKNOWN' } };
  });
  await f.cloud.invoke(auth, 'call', {
    ...args,
    params: { ...params, hostId: 'remote-control:book' },
  });
  assert.equal((await f.cloud.restore('mini')).tasks[0].turnId, null);
  const r = [...f.store.data.entries()].find(([key]) => key.startsWith('state:call:'))![1] as any;
  assert.equal(r.diagnostic.code, 'TURN_ID_CONFLICT');
});
