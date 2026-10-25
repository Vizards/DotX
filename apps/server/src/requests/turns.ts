import { BridgeError, errorCode } from '@dotx/shared/errors';
import { canonical } from '@dotx/shared/wire/commands';
import { terminal } from '@dotx/shared/requests';
import type { TurnObservation } from '@dotx/shared/requests';
import type { Observation } from '@dotx/shared/wire/observations';
import type { AtomicStore } from '../hub/storage.ts';
import { callGroup } from './retention.ts';
import type { EventTurn } from '../events/subscriptions.ts';
import type { InternalNotice as Notice } from '../events/subscriptions.ts';

import {
  callKey,
  requestKey,
  answerKey,
  unwrap,
  type CallRecord,
  type Answer,
  type Authority,
  type Dispatch,
  type Records,
} from './records.ts';
export function mergeTurn(r: CallRecord, o: TurnObservation, notices: Notice[]) {
  if (!r.task || o.task_id !== r.id) throw new BridgeError('TRACKING_ID_MISMATCH');
  const old = r.task;
  if (errorCode(r.diagnostic) === 'TURN_ID_CONFLICT') return;
  if (old.turnId && o.turnId && old.turnId !== o.turnId) throw new BridgeError('TURN_ID_CONFLICT');
  if (terminal(old.state)) return;
  // Dispatch receipt may arrive after the watcher has already located the turn.
  if (old.turnId && !o.turnId && ['accepted', 'reserved', 'unknown'].includes(o.state)) return;
  const changed = old.state !== o.state || (!old.turnId && !!o.turnId);
  r.task = { ...old, state: o.state, turnId: old.turnId ?? o.turnId, error: o.error ?? null };
  r.diagnostic = o.diagnostic ?? undefined;
  if (changed)
    notices.push({
      audience: r.principal,
      eventId: crypto.randomUUID(),
      name: 'gateway.request.updated',
      timestamp: new Date().toISOString(),
      data: {
        connection_id: r.connection_id,
        interface: r.interface,
        runtime_id: r.runtime_id,
        request_id: r.request_id,
        tracking: 'thread_turn',
        rpc_status: r.rpc_status,
        status: o.state,
        host_id: r.task.hostId,
        thread_id: r.task.threadId,
        ...(r.task.turnId ? { turn_id: r.task.turnId } : {}),
      },
    });
}
export class Turns {
  readonly records: Records;
  readonly dispatch: Dispatch;
  readonly store: AtomicStore;
  readonly resolving = new Map<string, Promise<CallRecord>>();
  constructor(records: Records, dispatch: Dispatch) {
    this.records = records;
    this.store = records.store;
    this.dispatch = dispatch;
  }
  async eventTurn(
    auth: Authority,
    args: Record<string, unknown>,
    inspect: boolean,
  ): Promise<EventTurn> {
    const connection = String(args.connection_id);
    if (!auth.devices.includes(connection)) throw new BridgeError('CONNECTION_NOT_AUTHORIZED');
    await this.records.assertActive(auth.principal);
    if (typeof args.request_id === 'string') {
      const id = await this.store.get<string>(requestKey(auth.principal, args.request_id));
      let r = id && (await this.store.get<CallRecord>(callKey(id)));
      // Subscribe before dispatch using the caller's chosen request ID.
      if (!r) return { connection_id: connection };
      if (r.connection_id !== connection) throw new BridgeError('EVENT_SOURCE_MISMATCH');
      if (!r.task) throw new BridgeError('SUBSCRIPTION_REQUIRES_TRACKED_TURN');
      if (inspect && !terminal(r.task.state)) r = await this.readTask(r, auth.devices);
      return {
        connection_id: connection,
        host_id: r.task!.hostId,
        thread_id: r.task!.threadId,
        turn_id: r.task!.turnId ?? undefined,
        state: r.task!.state,
      };
    }
    const turn: EventTurn = {
      connection_id: connection,
      host_id: String(args.host_id ?? 'local'),
      thread_id: String(args.thread_id),
      turn_id: String(args.turn_id),
    };
    if (inspect) {
      const result = unwrap(
        await this.dispatch(auth.principal, 'inspect_turn', {
          connection_id: connection,
          interface: 'client_coordination',
          task: {
            id: crypto.randomUUID(),
            request_id: '',
            connection_id: connection,
            hostId: turn.host_id,
            threadId: turn.thread_id,
            turnId: turn.turn_id,
            state: 'unknown',
          },
        }),
      ) as { observation: TurnObservation };
      turn.state = result.observation.state;
      if (turn.state === 'unknown')
        throw new BridgeError(
          'SUBSCRIPTION_TURN_UNAVAILABLE',
          'Read the current native turn before subscribing.',
          { cause: result.observation.diagnostic },
        );
    }
    return turn;
  }
  async observe(connection: string, observations: Observation[]) {
    const ids = await this.records.withNotices(async (tx, notices) => {
      const ids: string[] = [];
      for (const o of observations) {
        if (o.kind === 'turn') {
          const r = await tx.get<CallRecord>(callKey(o.task_id));
          // Cleanup may have removed the receipt while this observation was in transit.
          if (!r) {
            ids.push(o.id);
            continue;
          }
          if (r.connection_id !== connection) throw new BridgeError('TRACKING_ID_MISMATCH');
          if (!(await this.records.allowed(r.principal, tx))) {
            ids.push(o.id);
            continue;
          }
          const before = canonical(r);
          mergeTurn(r, o, notices);
          await this.records.saveCall(tx, r, before);
        } else {
          if (o.notice.data.connection_id !== connection)
            throw new BridgeError('EVENT_SOURCE_MISMATCH');
          const d = o.notice.data;
          if (d.interaction_key && d.status === 'resolved') {
            const k = answerKey(canonical([connection, d.interface, d.interaction_key]));
            const a = await tx.get<Answer>(k);
            if (a && a.status !== 'resolved') {
              a.status = 'resolved';
              await tx.put(k, a);
            }
          }
          notices.push(o.notice);
        }
        ids.push(o.id);
      }
      return ids;
    });
    return ids;
  }
  async readTask(record: CallRecord, allowed: string[]) {
    return this.records.retention.hold(callGroup(record.id), async () => {
      const current = await this.store.get<CallRecord>(callKey(record.id));
      if (!current) throw new BridgeError('REQUEST_NOT_FOUND');
      const r = await this.resolveAttribution(current, allowed);
      // Cross-host attribution already reported either no match or per-source failures.
      // Reading a turn without its identity would overwrite that evidence with another pending state.
      if (r.attribution_connections && !r.task!.turnId) return r;
      if (!terminal(r.task!.state)) {
        const reply = await this.dispatch(r.principal, 'read_turn', {
          connection_id: r.connection_id,
          interface: 'client_coordination',
          task: r.task,
        });
        const observation: TurnObservation = reply.ok
          ? (reply.result as { observation: TurnObservation }).observation
          : { task_id: r.id, state: 'unknown', turnId: r.task!.turnId, diagnostic: reply.error };
        await this.observe(r.connection_id, [
          { ...observation, id: crypto.randomUUID(), kind: 'turn' },
        ]);
      }
      return (await this.store.get<CallRecord>(callKey(r.id)))!;
    });
  }
  async resolveAttribution(record: CallRecord, allowed?: string[]): Promise<CallRecord> {
    if (
      !record.task ||
      record.task.turnId ||
      terminal(record.task.state) ||
      !record.attribution_connections ||
      errorCode(record.diagnostic) === 'TURN_ID_CONFLICT'
    )
      return record;
    const pending = this.resolving.get(record.id);
    if (pending) return pending;
    const work = (async () => {
      const sources = record.attribution_connections!.filter(
        (id) => !allowed || allowed.includes(id),
      );
      const replies = await Promise.all(
        sources.map((connection_id) =>
          this.dispatch(record.principal, 'resolve_turn', {
            connection_id,
            interface: 'app_server',
            task: { id: record.id, threadId: record.task!.threadId },
          }),
        ),
      );
      const ids = new Set(
        replies.flatMap((reply) => {
          const id = reply.ok && (reply.result as { turnId?: unknown })?.turnId;
          return typeof id === 'string' && id ? [id] : [];
        }),
      );
      return this.records.withNotices(async (tx, notices) => {
        const current = (await tx.get<CallRecord>(callKey(record.id)))!;
        if (!current.task || current.task.turnId || terminal(current.task.state)) return current;
        await this.records.assertActive(current.principal, tx);
        const before = canonical(current);
        const conflict =
          ids.size > 1 || replies.some((r) => !r.ok && errorCode(r.error) === 'TURN_ID_CONFLICT');
        if (conflict) {
          current.task.state = 'unknown';
          current.diagnostic = { code: 'TURN_ID_CONFLICT' };
        } else if (ids.size === 1) {
          // Preserve the source for exact-turn content reads; desktop status still
          // comes from the original entry point's coordination stream.
          current.task.turnId = [...ids][0];
          current.result_connection_id =
            sources[
              replies.findIndex(
                (reply) =>
                  reply.ok && (reply.result as { turnId?: string }).turnId === current.task!.turnId,
              )
            ];
          current.diagnostic = undefined;
        } else {
          const failures = replies.flatMap((reply, index) =>
            reply.ok ? [] : [{ connection_id: sources[index], error: reply.error }],
          );
          mergeTurn(
            current,
            {
              task_id: current.id,
              state: 'unknown',
              turnId: null,
              diagnostic: failures.length ? { failures } : { code: 'TURN_ATTRIBUTION_PENDING' },
            },
            notices,
          );
        }
        await this.records.saveCall(tx, current, before);
        return current;
      });
    })();
    this.resolving.set(record.id, work);
    try {
      return await work;
    } finally {
      this.resolving.delete(record.id);
    }
  }
}
