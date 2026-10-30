import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { BridgeError } from '@dotx/shared/errors';
import type { NativeResponse } from '@dotx/shared/wire/commands';

export type TurnIdentity = { id: string; threadId: string };
export type ResolveTurn = (task: TurnIdentity) => Promise<string | null>;

// PRIVATE CODEX FORMAT: App Tools propagates its caller envelope turnId into
// task_started.turn_attribution.parent_turn_id. Neither this rollout field nor
// thread/read's local path is a stable public contract. Keep this dependency here;
// missing attribution must stay unknown, never fall back to text or the latest turn.
export async function resolveTurn(
  task: TurnIdentity,
  call: (method: string, params: Record<string, unknown>) => Promise<NativeResponse>,
): Promise<string | null> {
  const reply = await call('thread/read', { threadId: task.threadId, includeTurns: false });
  if ('error' in reply) throw reply.error;
  const thread = (reply.result as { thread?: { id?: string; path?: string } })?.thread;
  if (thread?.id !== task.threadId) throw new BridgeError('ATTRIBUTION_THREAD_MISMATCH');
  if (!thread.path || !path.isAbsolute(thread.path))
    throw new BridgeError('ATTRIBUTION_PATH_UNAVAILABLE');
  const input = createReadStream(thread.path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let verified = false;
  let turnId: string | null = null;
  try {
    for await (const line of lines) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        // A currently written final record may be incomplete. Retry observation later.
        continue;
      }
      if (!verified) {
        if (row.type !== 'session_meta' || row.payload?.id !== task.threadId)
          throw new BridgeError('ATTRIBUTION_THREAD_MISMATCH');
        verified = true;
        continue;
      }
      const event = row.payload;
      if (row.type !== 'event_msg' || event?.type !== 'task_started') continue;
      const attribution = event.turn_attribution;
      if (
        attribution?.turn_trigger !== 'app_tool_send_message' ||
        attribution.parent_turn_id !== task.id
      )
        continue;
      if (typeof event.turn_id !== 'string' || attribution.turn_id !== event.turn_id)
        throw new BridgeError('ATTRIBUTION_SCHEMA_MISMATCH');
      if (turnId && turnId !== event.turn_id) throw new BridgeError('TURN_ID_CONFLICT');
      turnId = event.turn_id;
    }
    return turnId;
  } finally {
    lines.close();
    input.destroy();
  }
}
