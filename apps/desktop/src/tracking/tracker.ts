import { BridgeError, errorValue } from '@dotx/shared/errors';
import { readSchema } from '../interfaces/app-tools/schema.ts';
import type { NativeRead } from '../interfaces/app-tools/schema.ts';
import type { Call } from '@dotx/shared/wire/commands';
import type { FollowTarget, TrackedTask, TurnObservation } from '@dotx/shared/requests';
import type { ResolveTurn } from './attribution.ts';
import { terminal } from '@dotx/shared/requests';
import type { NativeClient } from '../interfaces/app-tools/transport.ts';
import type { CoordinationAdapter } from '../interfaces/coordination/adapter.ts';

export function validateThread(input: unknown, threadId: string, hostId = 'local'): NativeRead {
  const parsed = readSchema.safeParse(input);
  if (!parsed.success)
    throw new BridgeError('UNSUPPORTED_READ_SCHEMA', undefined, { cause: parsed.error });
  const data = parsed.data;
  if (data.thread.id !== threadId || data.thread.kind !== 'codex' || data.thread.hostId !== hostId)
    throw new BridgeError('TARGET_IDENTITY_MISMATCH', undefined, {
      cause: {
        expected: { threadId, hostId, kind: 'codex' },
        received: { threadId: data.thread.id, hostId: data.thread.hostId, kind: data.thread.kind },
      },
    });
  return data;
}
const target = (task: TrackedTask): FollowTarget => ({
  hostId: task.hostId,
  conversationId: task.threadId,
});

export class TurnTracker {
  readonly tasks = new Map<string, TrackedTask>();
  readonly native: NativeClient;
  readonly caller: string;
  readonly report: (observation: TurnObservation) => void;
  readonly resolveTurn: ResolveTurn;
  readonly coordination: Pick<CoordinationAdapter, 'current' | 'read'>;
  constructor(
    native: NativeClient,
    caller: string,
    report: (observation: TurnObservation) => void,
    resolveTurn: ResolveTurn,
    coordination: Pick<CoordinationAdapter, 'current' | 'read'>,
  ) {
    this.native = native;
    this.caller = caller;
    this.report = report;
    this.resolveTurn = resolveTurn;
    this.coordination = coordination;
  }

  async send(task: TrackedTask, params: Call['params']) {
    // Only this one cloud dispatch carries a prompt. Queries never resend it.
    let sent = false;
    let observation: TurnObservation;
    try {
      if (task.threadId === this.caller) throw new BridgeError('CALLER_IS_NOT_A_TARGET');
      const before = validateThread(
        await this.native.call('read_thread', {
          hostId: task.hostId,
          threadId: task.threadId,
          turnLimit: 1,
          includeOutputs: false,
        }),
        task.threadId,
        task.hostId,
      );
      if (!['idle', 'notLoaded'].includes(before.thread.status?.type ?? ''))
        throw new BridgeError('TARGET_BUSY', undefined, {
          cause: { status: before.thread.status },
        });
      sent = true;
      const reply = (await this.native.call('send_message_to_thread', params, {
        turnId: task.id,
      })) as { threadId?: string };
      if (reply?.threadId !== task.threadId)
        throw new BridgeError('SEND_RESPONSE_MISMATCH', undefined, {
          cause: { expected: task.threadId, received: reply?.threadId },
        });
      observation = { task_id: task.id, state: 'accepted', turnId: null };
    } catch (error) {
      observation = {
        task_id: task.id,
        state: sent ? 'unknown' : 'rejected',
        turnId: null,
        diagnostic: errorValue(error),
      };
    }
    return observation;
  }
  async inspect(task: TrackedTask): Promise<{ observation: TurnObservation }> {
    let turnId = task.turnId;
    try {
      // Cross-host attribution is resolved by the DO at the target Mac's connector.
      turnId ??= task.hostId === 'local' ? await this.resolveTurn(task) : null;
      if (!turnId) throw new BridgeError('TURN_ATTRIBUTION_PENDING');
      await this.coordination.read(target(task));
      return { observation: this.observe({ ...task, turnId }) };
    } catch (error) {
      return {
        observation: { task_id: task.id, state: 'unknown', turnId, diagnostic: errorValue(error) },
      };
    }
  }
  private observe(task: TrackedTask): TurnObservation {
    const snapshot = this.coordination.current(target(task));
    const turn = snapshot?.turns.find((t) => t.turnId === task.turnId);
    if (!turn)
      return {
        task_id: task.id,
        state: 'unknown',
        turnId: task.turnId,
        diagnostic: { code: snapshot ? 'TURN_NOT_IN_CURRENT_SNAPSHOT' : 'TURN_STATE_UNAVAILABLE' },
      };
    // PRIVATE CODEX STATE: only the exact turn's status proves completion. An idle
    // thread or another completed turn does not. Gaps require an explicit query,
    // never automatic snapshot recovery or historical scanning.
    const state = ['completed', 'failed', 'interrupted'].includes(turn.status)
      ? (turn.status as 'completed' | 'failed' | 'interrupted')
      : turn.status === 'inProgress'
        ? snapshot!.threadRuntimeStatus?.activeFlags?.some((x: string) => /approval|input/i.test(x))
          ? 'waiting_approval'
          : 'running'
        : 'unknown';
    return {
      task_id: task.id,
      state,
      turnId: task.turnId,
      error: turn.error ?? null,
      diagnostic: state === 'unknown' ? { code: 'TURN_STATUS_UNKNOWN', status: turn.status } : null,
    };
  }
  private remember(task: TrackedTask, observation: TurnObservation) {
    if (terminal(observation.state) || observation.state === 'unknown') this.tasks.delete(task.id);
    else this.tasks.set(task.id, { ...task, ...observation });
  }
  async query(task: TrackedTask) {
    const read = await this.inspect(task);
    this.remember(task, read.observation);
    return read;
  }
  changed(changed: FollowTarget) {
    for (const task of this.tasks.values()) {
      if (task.hostId !== changed.hostId || task.threadId !== changed.conversationId) continue;
      const observation = this.observe(task);
      this.remember(task, observation);
      this.report(observation);
    }
  }
}
