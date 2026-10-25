import { Buffer } from 'node:buffer';
import { BridgeError, errorCode } from '@dotx/shared/errors';
import { canonical } from '@dotx/shared/wire/commands';
import type { Call, NativeResponse } from '@dotx/shared/wire/commands';
import type { Outcome } from '@dotx/shared/requests';
import type { DeviceOperation, TrackedTask } from '@dotx/shared/requests';
import type { ResponseRoute } from '@dotx/shared/wire/observations';
import type { AtomicStore, Store } from '../hub/storage.ts';
import type { Events } from '../events/subscriptions.ts';
import type { InternalNotice as Notice } from '../events/subscriptions.ts';

import { mergeTurn } from './turns.ts';
import { Retention } from './retention.ts';
export interface Authority {
  principal: string;
  devices: string[];
}
export type Dispatch = (
  principal: string,
  operation: DeviceOperation,
  args: Record<string, unknown>,
  id?: string,
) => Promise<Outcome>;
export interface CallRecord extends Omit<Call, 'params' | 'request_id'> {
  request_id: string;
  id: string;
  principal: string;
  digest: string;
  created_at: number;
  updated_at: number;
  rpc_status: 'pending' | 'returned' | 'error' | 'unknown' | 'rejected';
  diagnostic?: unknown;
  task?: TrackedTask;
  attribution_connections?: string[];
  result_connection_id?: string;
}
export interface Answer {
  principal: string;
  route: ResponseRoute;
  digest: string;
  dispatchId: string;
  status: 'responding' | 'submitted' | 'resolved' | 'unknown' | 'rejected';
  diagnostic?: unknown;
}
export const requestKey = (principal: string, id: string) =>
  'state:request:' + canonical([principal, id]);
export const callKey = (id: string) => 'state:call:' + id;
export const eventKey = (principal: string, id: string) =>
  'state:event:' + canonical([principal, id]);
export const answerKey = (key: string) => 'state:answer:' + key;
export async function digest(v: unknown) {
  return Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(v))),
  ).toString('hex');
}
export const unsent = new Set([
  'DEVICE_OFFLINE',
  'DEVICE_UNAVAILABLE',
  'RUNTIME_CHANGED',
  'INTERFACE_UNAVAILABLE',
  'NATIVE_METHOD_NOT_FOUND',
  'PROTOCOL_LIFECYCLE_MANAGED',
  'TRACKING_CONTEXT_REQUIRED',
  'EVENT_EXPIRED',
  'EVENT_RUNTIME_EXPIRED',
]);
export const unwrap = (o: Outcome): any => {
  if (!o.ok) throw o.error;
  return o.result;
};

export class Records {
  readonly store: AtomicStore;
  readonly events: Events;
  readonly retention: Retention;
  readonly inFlight = new Set<string>();
  readonly allowed: (principal: string, tx?: Store) => Promise<boolean>;
  constructor(
    store: AtomicStore,
    events: Events,
    allowed: Records['allowed'],
    retentionDays?: string,
  ) {
    this.store = store;
    this.events = events;
    this.allowed = allowed;
    this.retention = new Retention(store, retentionDays);
  }
  async assertActive(principal: string, tx?: Store) {
    if (!(await this.allowed(principal, tx))) throw new BridgeError('AGENT_AUTHORIZATION_REVOKED');
  }
  async withNotices<T>(callback: (tx: Store, notices: Notice[]) => Promise<T>) {
    const { result, notices } = await this.store.transaction(async (tx) => {
      const notices: Notice[] = [];
      return { result: await callback(tx, notices), notices };
    });
    this.events.publish(notices);
    return result;
  }
  async recordReply(
    id: string,
    reply: Outcome,
    source?: { connection: string; runtimes: string[] },
  ) {
    await this.withNotices(async (tx, notices) => {
      const r = await tx.get<CallRecord>(callKey(id));
      if (r) {
        if (!(await this.allowed(r.principal, tx))) return;
        if (
          source &&
          (r.connection_id !== source.connection || !source.runtimes.includes(r.runtime_id))
        )
          throw new BridgeError('REPLY_SOURCE_MISMATCH');
        // The WebSocket handler may already have recorded this reply before
        // dispatch returns. Ordinary terminal receipts have nothing left to merge.
        if (!r.task && ['returned', 'error', 'rejected'].includes(r.rpc_status)) return;
        const before = canonical(r);
        const result = reply.ok ? (reply.result as any) : undefined;
        const next = reply.ok
          ? result.rpc_status
          : unsent.has(errorCode(reply.error) ?? '')
            ? 'rejected'
            : 'unknown';
        // A timeout or stale report cannot erase a native reply already observed by the DO.
        if (!['returned', 'error', 'rejected'].includes(r.rpc_status)) {
          r.rpc_status = ['returned', 'error', 'rejected', 'unknown'].includes(next)
            ? next
            : 'unknown';
          r.diagnostic = reply.ok ? result.diagnostic : reply.error;
        }
        if (r.task) {
          if (result?.observation) mergeTurn(r, result.observation, notices);
          else if (!reply.ok && (r.rpc_status === 'rejected' || !r.task.turnId))
            mergeTurn(
              r,
              {
                task_id: r.id,
                state: r.rpc_status === 'rejected' ? 'rejected' : 'unknown',
                turnId: null,
                diagnostic: reply.error,
              },
              notices,
            );
        }
        await this.saveCall(tx, r, before);
        return;
      }
      const key = await tx.get<string>('state:answer-dispatch:' + id);
      const answer = key && (await tx.get<Answer>(answerKey(key)));
      if (!answer || answer.dispatchId !== id || !(await this.allowed(answer.principal, tx)))
        return;
      if (
        source &&
        (answer.route.connection_id !== source.connection ||
          !source.runtimes.includes(answer.route.runtime_id))
      )
        throw new BridgeError('REPLY_SOURCE_MISMATCH');
      if (!['responding', 'unknown', 'resolved'].includes(answer.status)) return;
      const before = canonical(answer);
      const result = reply.ok ? (reply.result as any) : undefined;
      if (answer.status !== 'resolved')
        answer.status = reply.ok
          ? ['submitted', 'resolved', 'rejected', 'unknown'].includes(result.response_status)
            ? result.response_status
            : 'unknown'
          : unsent.has(errorCode(reply.error) ?? '')
            ? 'rejected'
            : 'unknown';
      answer.diagnostic = reply.ok ? result.diagnostic : reply.error;
      if (canonical(answer) !== before) await tx.put(answerKey(key as string), answer);
    });
  }
  async saveCall(tx: Store, r: CallRecord, before: string) {
    if (canonical(r) === before) return;
    r.updated_at = Date.now();
    await tx.put(callKey(r.id), r);
  }
  public(r: CallRecord, native?: NativeResponse, result?: unknown) {
    const {
      id: _id,
      principal: _principal,
      digest: _digest,
      attribution_connections: _connections,
      result_connection_id: _resultConnection,
      task,
      ...fields
    } = r;
    return {
      ...fields,
      expires_at: this.retention.expiresAt(r.created_at),
      ...(native === undefined ? {} : { native }),
      ...(task
        ? {
            operation: {
              requestId: r.request_id,
              deviceId: r.connection_id,
              hostId: task.hostId,
              threadId: task.threadId,
              state: task.state,
              turnId: task.turnId,
              completed: task.state === 'completed',
              ...(task.error == null ? {} : { error: task.error }),
              ...(result === undefined ? {} : { result }),
            },
          }
        : {}),
      result_available: native !== undefined || result !== undefined,
      ...(native === undefined && !task && ['returned', 'error'].includes(r.rpc_status)
        ? { result_unavailable_reason: 'RPC_PAYLOAD_NOT_RETAINED' }
        : {}),
    };
  }
}
