import { BridgeError } from '@dotx/shared/errors';
import type { NativeResponse } from '@dotx/shared/wire/commands';
import type { NativeItem } from '../interfaces/app-tools/schema.ts';
import type { TrackedTask } from '@dotx/shared/requests';

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
  if ('error' in reply) throw reply.error;
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
    items: page.data.map((entry) => entry.item),
    nextCursor: page.nextCursor,
  };
}
