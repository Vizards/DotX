import { BridgeError } from '@dotx/shared/errors';
import type { NativeResponse } from '@dotx/shared/gateway';
import type { NativeItem } from '@dotx/shared/protocol';
import type { TrackedTask } from '@dotx/shared/state';

// Status comes from observed desktop turns, never from the presence of output items.
// Read one native page addressed to the exact turn. Expose its cursor rather than
// implementing another pagination loop; callers can use the native method for more content.
export async function readTurnResult(
  task: TrackedTask,
  call: (method: string, params: Record<string, unknown>) => Promise<NativeResponse>,
) {
  if (!task.turnId) throw new BridgeError('TURN_ATTRIBUTION_PENDING');
  const reply = await call('thread/items/list', {
    threadId: task.threadId,
    turnId: task.turnId,
    sortDirection: 'desc',
  });
  if (reply.error) throw new BridgeError('NATIVE_RESULT_READ_FAILED', reply.error.message);
  const page = reply.result as {
    data: { turnId: string; item: NativeItem }[];
    nextCursor: string | null;
  };
  if (page.data.some((entry) => entry.turnId !== task.turnId))
    throw new BridgeError('TURN_ID_CONFLICT');
  return {
    turnId: task.turnId,
    status: task.state,
    error: task.error ?? null,
    items: page.data.map((entry) => entry.item).filter((item) => item.type === 'agentMessage'),
    nextCursor: page.nextCursor,
  };
}
