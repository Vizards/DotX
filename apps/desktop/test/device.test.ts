import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnTracker } from '../src/tracking/tracker.ts';
import { nativeFixture, params, task } from './fixtures/native.ts';
function fixture() {
  const f = nativeFixture();
  return { ...f, tracker: new TurnTracker(f.native, 'caller', () => {}, f.resolveTurn) };
}
test('tracked sends preserve omitted, model-only and thinking-only options and long prompts', async () => {
  for (const overrides of [{}, { model: 'catalog-model' }, { thinking: 'high' }]) {
    const f = fixture(),
      input = { ...params, ...overrides, prompt: 'x'.repeat(25000) };
    assert.equal((await f.tracker.send(task(), input)).state, 'accepted');
    assert.deepEqual(f.state.lastSend, input);
  }
});
test('accepted is not completed; hidden attribution selects turn, never latest text or another delegation', async () => {
  const f = fixture(),
    t = task();
  const sent = await f.tracker.send(t, params);
  assert.equal(sent.state, 'accepted');
  assert.equal(f.state.reads, 1);
  f.state.turns[0].status = 'completed';
  f.state.turns[0].items.push({ type: 'agentMessage', text: 'right' });
  f.state.turns[0].items.unshift({ type: 'functionCallOutput', output: ['unrelated'] });
  f.state.turns.unshift({
    id: 'wrong',
    status: 'completed',
    items: [
      { type: 'agentMessage', text: params.prompt },
      {
        type: 'functionCallOutput',
        namespace: 'codex_app',
        name: 'send_message_to_thread',
        output: {
          text: '<source_thread_id>caller</source_thread_id><input>another-marker\nsynthetic only</input>',
        },
      },
    ],
  });
  const result = await f.tracker.inspect(t);
  assert.equal(result.observation.state, 'completed');
  assert.equal(result.observation.turnId, 'matching-turn');
  assert.equal(result.result?.items[0].text, 'right');
  assert.equal(f.state.calls, 1);
});
test('restoring metadata after a lost response observes native history without sending', async () => {
  const f = fixture(),
    t = task();
  f.state.loseResponse = true;
  assert.equal((await f.tracker.send(t, params)).state, 'unknown');
  f.state.turns[0].status = 'completed';
  const reports: unknown[] = [];
  const next = new TurnTracker(f.native, 'caller', (o) => reports.push(o), f.resolveTurn);
  next.restore([t]);
  await next.tick();
  assert.equal((reports[0] as any).state, 'completed');
  assert.equal(f.state.calls, 1);
  next.restore([]);
  assert.equal(next.tasks.size, 0);
});
test('unknown unobserved input never adopts unrelated completion; acceptance grace does not extend', async () => {
  const f = fixture(),
    t = task();
  f.state.dropInput = true;
  await f.tracker.send(t, params);
  t.state = 'accepted';
  assert.equal((await f.tracker.inspect(t)).observation.state, 'accepted');
  t.startedAt -= 31000;
  f.state.turns.push({
    id: 'other',
    status: 'completed',
    items: [{ type: 'agentMessage', text: params.prompt }],
  });
  assert.equal((await f.tracker.inspect(t)).observation.state, 'unknown');
  assert.equal(f.state.calls, 1);
});
test('tracking rejects busy, wrong-host, wrong-kind and caller targets before sending', async () => {
  for (const override of [
    { threadStatus: { type: 'active' } },
    { hostId: 'other' },
    { kind: 'chatgpt' },
  ]) {
    const f = fixture();
    Object.assign(f.state, override);
    assert.equal((await f.tracker.send(task(), params)).state, 'rejected');
    assert.equal(f.state.calls, 0);
  }
  const f = fixture();
  assert.equal(
    (await f.tracker.send({ ...task(), threadId: 'caller' }, params)).diagnostic?.code,
    'CALLER_IS_NOT_A_TARGET',
  );
  assert.equal(f.state.calls, 0);
});
test('approval, failure and interruption are distinct from completion; exact host retained', async () => {
  for (const status of ['failed', 'interrupted', 'inProgress']) {
    const f = fixture(),
      t = { ...task(), hostId: 'remote-control:book' };
    await f.tracker.send(t, { ...params, hostId: t.hostId });
    t.turnId = await f.resolveTurn(t);
    f.state.turns[0].status = status;
    f.state.threadStatus = { type: 'active', activeFlags: ['waitingOnApproval'] };
    assert.equal(
      (await f.tracker.inspect(t)).observation.state,
      status === 'inProgress' ? 'waiting_approval' : status,
    );
    assert.equal(f.state.lastSend!.hostId, t.hostId);
  }
});
test('malformed native read is diagnosed before sending', async () => {
  let sends = 0;
  const tracker = new TurnTracker(
    {
      async call(method) {
        if (method === 'send_message_to_thread') sends++;
        return { turns: 'invalid' };
      },
    },
    'caller',
    () => {},
    async () => null,
  );
  assert.equal((await tracker.send(task(), params)).diagnostic?.code, 'UNSUPPORTED_READ_SCHEMA');
  assert.equal(sends, 0);
});
