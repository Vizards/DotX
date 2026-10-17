import { BridgeError, safeError } from '@dotx/shared/errors';
import { readSchema } from '@dotx/shared/protocol';
import type { NativeRead, NativeItem } from '@dotx/shared/protocol';
import type { TrackedTask, TurnObservation } from '@dotx/shared/state';
import type { ResolveTurn } from './attribution.ts';
import { terminal } from '@dotx/shared/state';
import type { NativeClient } from '../interfaces/app-tools/transport.ts';

export function validateThread(input: unknown, threadId: string, hostId = 'local'): NativeRead {
  const parsed = readSchema.safeParse(input);
  if (!parsed.success) throw new BridgeError('UNSUPPORTED_READ_SCHEMA');
  const data = parsed.data;
  if (data.thread.id !== threadId || data.thread.kind !== 'codex' || data.thread.hostId !== hostId)
    throw new BridgeError('TARGET_IDENTITY_MISMATCH');
  return data;
}

export class TurnTracker {
  readonly tasks = new Map<string, TrackedTask>();
  readonly busy = new Set<string>();
  readonly native: NativeClient;
  readonly caller: string;
  readonly resolveTurn: ResolveTurn;
  readonly report: (observation: TurnObservation) => void;
  constructor(
    native: NativeClient,
    caller: string,
    report: (observation: TurnObservation) => void,
    resolveTurn: ResolveTurn,
  ) {
    this.native = native;
    this.caller = caller;
    this.report = report;
    this.resolveTurn = resolveTurn;
  }

  restore(tasks: TrackedTask[]) {
    const ids = new Set(tasks.map((t) => t.id));
    for (const id of this.tasks.keys()) if (!ids.has(id)) this.tasks.delete(id);
    for (const task of tasks) {
      const previous = this.tasks.get(task.id);
      this.tasks.set(
        task.id,
        previous?.turnId && !task.turnId ? { ...task, turnId: previous.turnId } : task,
      );
    }
  }
  async read(task: TrackedTask, cursor?: string, small = false) {
    if (task.threadId === this.caller) throw new BridgeError('CALLER_IS_NOT_A_TARGET');
    return validateThread(
      await this.native.call('read_thread', {
        hostId: task.hostId,
        threadId: task.threadId,
        turnLimit: small ? 1 : 10,
        includeOutputs: !small,
        maxOutputCharsPerItem: small ? 100 : 16000,
        ...(cursor ? { cursor } : {}),
      }),
      task.threadId,
      task.hostId,
    );
  }
  async send(task: TrackedTask, params: Record<string, unknown>) {
    // No replay queue. Only the one cloud dispatch carries a prompt; restore never does.
    let sent = false;
    let observation: TurnObservation;
    this.busy.add(task.id);
    try {
      const before = await this.read(task, undefined, true);
      if (!['idle', 'notLoaded'].includes(before.thread.status?.type ?? ''))
        throw new BridgeError('TARGET_BUSY');
      sent = true;
      const reply = (await this.native.call('send_message_to_thread', params, {
        turnId: task.id,
      })) as { threadId?: string };
      if (reply.threadId !== task.threadId) throw new BridgeError('SEND_RESPONSE_MISMATCH');
      observation = { task_id: task.id, state: 'accepted', turnId: null };
    } catch (error) {
      observation = {
        task_id: task.id,
        state: sent ? 'unknown' : 'rejected',
        turnId: null,
        diagnostic: safeError(error),
      };
    } finally {
      this.busy.delete(task.id);
    }
    this.tasks.set(task.id, { ...task, ...observation });
    return observation;
  }
  async inspect(task: TrackedTask): Promise<{
    observation: TurnObservation;
    result?: {
      turnId: string;
      status: string;
      error: unknown;
      items: NativeItem[];
      contentLimit: { maxOutputCharsPerItem: number; truncationPossible: boolean };
    };
  }> {
    let cursor: string | null | undefined;
    try {
      // A remote target's rollout belongs to its own connector. The DO resolves
      // that attribution and restores the bound turnId to this original route.
      const turnId = task.turnId ?? (task.hostId === 'local' ? await this.resolveTurn(task) : null);
      if (!turnId)
        return {
          observation: {
            task_id: task.id,
            state:
              task.state === 'accepted' && Date.now() - task.startedAt < 30000
                ? 'accepted'
                : 'unknown',
            turnId: null,
            diagnostic: { code: 'TURN_ATTRIBUTION_PENDING' },
          },
        };
      task = { ...task, turnId };
      for (let page = 0; page < 20; page++) {
        const data = await this.read(task, cursor ?? undefined);
        const found = data.turns.find((t) => t.id === turnId);
        if (found) {
          const state = ['completed', 'failed', 'interrupted'].includes(found.status)
            ? (found.status as 'completed' | 'failed' | 'interrupted')
            : data.thread.status?.activeFlags?.some((x) => /approval|input/i.test(x))
              ? 'waiting_approval'
              : 'running';
          return {
            observation: {
              task_id: task.id,
              state,
              turnId: found.id,
              diagnostic: null,
            } satisfies TurnObservation,
            ...(terminal(state)
              ? {
                  result: {
                    turnId: found.id,
                    status: found.status,
                    error: found.error,
                    items: (found.items ?? []).filter((i) => i.type === 'agentMessage'),
                    contentLimit: { maxOutputCharsPerItem: 16000, truncationPossible: true },
                  },
                }
              : {}),
          };
        }
        cursor = data.page?.nextCursor;
        if (!cursor) break;
      }
      return {
        observation: {
          task_id: task.id,
          state:
            task.state === 'accepted' && Date.now() - task.startedAt < 30000
              ? 'accepted'
              : 'unknown',
          turnId: task.turnId,
          diagnostic: { code: cursor ? 'RECONCILIATION_PAGE_LIMIT' : 'TURN_NOT_YET_OBSERVED' },
        } satisfies TurnObservation,
      };
    } catch (error) {
      return {
        observation: {
          task_id: task.id,
          state: 'unknown',
          turnId: task.turnId,
          diagnostic: safeError(error),
        } satisfies TurnObservation,
      };
    }
  }
  async tick() {
    for (const task of this.tasks.values()) {
      if (this.busy.has(task.id) || terminal(task.state)) continue;
      this.busy.add(task.id);
      try {
        const { observation } = await this.inspect(task);
        this.tasks.set(task.id, { ...task, ...observation });
        this.report(observation);
      } finally {
        this.busy.delete(task.id);
      }
    }
  }
}
