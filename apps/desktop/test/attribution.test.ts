import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTurn } from '../src/tracking/attribution.ts';

const start = (parent: string, turn: string) => ({
  type: 'event_msg',
  payload: {
    type: 'task_started',
    turn_id: turn,
    turn_attribution: {
      turn_id: turn,
      parent_turn_id: parent,
      turn_trigger: 'app_tool_send_message',
    },
  },
});
test('native attribution survives reader reconstruction, distinguishes identical prompts and rejects ambiguous turns', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attribution-'));
  const file = path.join(dir, 'native.jsonl');
  const rows = [
    { type: 'session_meta', payload: { id: 'target' } },
    start('parent-a', 'turn-a'),
    { type: 'event_msg', payload: { type: 'user_message', message: 'identical' } },
    start('parent-b', 'turn-b'),
    { type: 'event_msg', payload: { type: 'user_message', message: 'identical' } },
  ];
  const write = () => fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const call = async () => ({ result: { thread: { id: 'target', path: file } } });
  try {
    write();
    for (let restart = 0; restart < 2; restart++) {
      assert.equal(await resolveTurn({ id: 'parent-a', threadId: 'target' }, call), 'turn-a');
      assert.equal(await resolveTurn({ id: 'parent-b', threadId: 'target' }, call), 'turn-b');
    }
    assert.equal(await resolveTurn({ id: 'absent', threadId: 'target' }, call), null);
    fs.appendFileSync(file, '{"type":"event_msg"');
    assert.equal(await resolveTurn({ id: 'parent-a', threadId: 'target' }, call), 'turn-a');
    rows.push(start('parent-a', 'unrelated'));
    write();
    await assert.rejects(resolveTurn({ id: 'parent-a', threadId: 'target' }, call), {
      code: 'TURN_ID_CONFLICT',
    });
    rows[0] = { type: 'session_meta', payload: { id: 'wrong-thread' } };
    write();
    await assert.rejects(resolveTurn({ id: 'parent-a', threadId: 'target' }, call), {
      code: 'ATTRIBUTION_THREAD_MISMATCH',
    });
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
