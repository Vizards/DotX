import type { NativeTurn, NativeItem, ThreadStatus } from '@dotx/shared/protocol';
import type { TrackedTask } from '@dotx/shared/state';
export const params = { threadId: 'thread-1234', hostId: 'local', prompt: 'synthetic only' };
export function task(): TrackedTask {
  return {
    id: 'task-1234',
    request_id: 'request-1234',
    connection_id: 'mini',
    hostId: 'local',
    threadId: params.threadId,
    turnId: null,
    state: 'reserved',
    startedAt: Date.now(),
  };
}
export function nativeFixture() {
  const state: {
    calls: number;
    reads: number;
    threadStatus: ThreadStatus;
    turns: (NativeTurn & { items: NativeItem[] })[];
    hostId?: string;
    kind?: string;
    dropInput?: boolean;
    loseResponse?: boolean;
    lastSend?: Record<string, unknown>;
  } = {
    calls: 0,
    reads: 0,
    threadStatus: { type: 'idle' },
    turns: [],
  };
  const parents = new Map<string, string>();
  const resolveTurn = async (task: { id: string }) => parents.get(task.id) ?? null;
  const native = {
    async call(method: string, input: Record<string, unknown>, context?: { turnId: string }) {
      if (method === 'read_thread') {
        state.reads++;
        return {
          schemaVersion: 1,
          thread: {
            id: input.threadId,
            kind: state.kind ?? 'codex',
            hostId: state.hostId ?? input.hostId,
            status: state.threadStatus,
          },
          turns: state.turns,
          page: { hasMore: false, nextCursor: null },
        };
      }
      if (method !== 'send_message_to_thread') throw Error('Unexpected native method');
      state.calls++;
      state.lastSend = input;
      if (!state.dropInput && context) parents.set(context.turnId, 'matching-turn');
      if (!state.dropInput)
        state.turns.unshift({
          id: 'matching-turn',
          status: 'inProgress',
          items: [
            {
              type: 'functionCallOutput',
              namespace: 'codex_app',
              name: method,
              output: {
                text: `<source_thread_id>caller</source_thread_id><input>${input.prompt}</input>`,
              },
            },
          ],
        });
      if (state.loseResponse)
        throw Object.assign(Error('lost response'), { code: 'DESKTOP_TIMEOUT' });
      return { threadId: input.threadId };
    },
  };
  return { state, native, resolveTurn };
}
