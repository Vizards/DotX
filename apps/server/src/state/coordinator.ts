import { BridgeError } from '@dotx/shared/errors';
import { gatewaySchemas, canonical } from '@dotx/shared/gateway';
import type { Call, GatewayOperation, NativeEvent, NativeResponse } from '@dotx/shared/gateway';
import type { Outcome } from '@dotx/shared/protocol';
import { terminal, interactionKey, trackedParams } from '@dotx/shared/state';
import type {
  DeviceOperation,
  TrackedTask,
  TurnObservation,
  Observation,
  ResponseRoute,
} from '@dotx/shared/state';
import type { Store } from '../hub/storage.ts';
import type { EventStore, Events } from '../events/subscriptions.ts';

export interface Authority {
  principal: string;
  devices: string[];
}
export type Dispatch = (
  operation: DeviceOperation,
  args: Record<string, unknown>,
  id?: string,
) => Promise<Outcome>;
interface CallRecord extends Omit<Call, 'params'> {
  id: string;
  principal: string;
  digest: string;
  created_at: number;
  updated_at: number;
  rpc_status: 'pending' | 'returned' | 'error' | 'unknown' | 'rejected';
  diagnostic?: { code: string; message?: string };
  task?: TrackedTask;
  attribution_connections?: string[];
  result_connection_id?: string;
}
interface Answer {
  route: ResponseRoute;
  digest: string;
  dispatchId: string;
  status: 'responding' | 'submitted' | 'resolved' | 'unknown' | 'rejected';
  diagnostic?: { code: string; message?: string };
}
const requestKey = (principal: string, id: string) => 'state:request:' + canonical([principal, id]);
const callKey = (id: string) => 'state:call:' + id;
const eventKey = (principal: string, id: string) => 'state:event:' + canonical([principal, id]);
const answerKey = (key: string) => 'state:answer:' + key;
async function digest(v: unknown) {
  return Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(v))),
  ).toString('hex');
}
const unsent = new Set([
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
const unwrap = (o: Outcome): any => {
  if (!o.ok) throw new BridgeError(o.error.code, o.error.message);
  return o.result;
};

// Sole durable owner. No RPC payload archive and no replay of dispatched writes.
// Desktop adapters retain native protocol knowledge; this class owns only routing and intent.
export class Coordinator {
  readonly inFlight = new Set<string>();
  readonly resolving = new Map<string, Promise<CallRecord>>();
  readonly store: EventStore;
  readonly dispatch: Dispatch;
  readonly events: Events;
  constructor(store: EventStore, dispatch: Dispatch, events: Events) {
    this.store = store;
    this.dispatch = dispatch;
    this.events = events;
  }
  authorize(auth: Authority, connection: string) {
    if (!auth.devices.includes(connection)) throw new BridgeError('CONNECTION_NOT_AUTHORIZED');
  }
  async invoke(auth: Authority, operation: GatewayOperation, input: unknown): Promise<any> {
    if (operation === 'get_request') {
      const { request_id } = gatewaySchemas.get_request.parse(input);
      const id = await this.store.get<string>(requestKey(auth.principal, request_id));
      let r = id && (await this.store.get<CallRecord>(callKey(id)));
      if (!r) throw new BridgeError('REQUEST_NOT_FOUND');
      this.authorize(auth, r.connection_id);
      if (r.rpc_status === 'pending' && !this.inFlight.has(r.id)) {
        await this.recordReply(r.id, { ok: false, error: { code: 'DISPATCH_OUTCOME_UNKNOWN' } });
      }
      let result: unknown;
      let resultDiagnostic: string | undefined;
      if (r.task && r.task.state !== 'rejected') {
        r = await this.readTask(r, auth.devices);
        if (r.task!.turnId && terminal(r.task!.state)) {
          // A remote host's files belong to its own connector, not the original entry point.
          const connection = r.result_connection_id ?? r.connection_id;
          this.authorize(auth, connection);
          const reply = await this.dispatch('read_turn_result', {
            connection_id: connection,
            interface: 'app_server',
            task: r.task,
          });
          if (reply.ok) result = reply.result;
          else resultDiagnostic = reply.error.code;
        }
      }
      return {
        ...this.public((await this.store.get<CallRecord>(callKey(r.id)))!, undefined, result),
        ...(resultDiagnostic ? { result_unavailable_reason: resultDiagnostic } : {}),
      };
    }
    if (operation === 'respond') return this.respond(auth, gatewaySchemas.respond.parse(input));
    const args = gatewaySchemas[operation].parse(input);
    this.authorize(auth, args.connection_id);
    if (operation === 'call') return this.call(auth, gatewaySchemas.call.parse(input));
    const result = unwrap(await this.dispatch(operation, args));
    if (operation === 'read_events') {
      for (const e of result.events as NativeEvent[]) {
        if (
          e.connection_id !== args.connection_id ||
          e.interface !== args.interface ||
          e.runtime_id !== (args as any).runtime_id
        )
          throw new BridgeError('EVENT_SOURCE_MISMATCH');
        if (e.kind !== 'server_request') continue;
        const route: ResponseRoute = {
          connection_id: e.connection_id,
          interface: e.interface,
          runtime_id: e.runtime_id,
          event_id: e.event_id,
          key: interactionKey(e),
        };
        await this.store.put(eventKey(auth.principal, e.event_id), route);
        const answer = await this.store.get<Answer>(answerKey(route.key));
        if (answer) {
          if (e.response_status === 'resolved') {
            await this.resolveInteraction(route.key);
            answer.status = 'resolved';
          }
          if (answer.status !== 'rejected') e.response_status = answer.status;
          e.response_diagnostic = answer.diagnostic;
        }
      }
    }
    return result;
  }
  async call(auth: Authority, args: Call) {
    const hash = await digest(args),
      key = requestKey(auth.principal, args.request_id);
    if (args.tracking === 'thread_turn') {
      if (args.interface !== 'app_tools' || args.method !== 'codex_app.send_message_to_thread')
        throw new BridgeError('TRACKING_NOT_SUPPORTED');
      if (
        Object.keys(args.params).some(
          (k) => !['hostId', 'threadId', 'prompt', 'model', 'thinking'].includes(k),
        )
      )
        throw new BridgeError('TRACKING_PARAMETERS_UNSUPPORTED');
      trackedParams.parse(args.params);
    }
    const reserved = await this.store.transaction(async (tx) => {
      const existingId = await tx.get<string>(key);
      if (existingId) {
        const r = (await tx.get<CallRecord>(callKey(existingId)))!;
        if (r.digest !== hash) throw new BridgeError('IDEMPOTENCY_CONFLICT');
        return { created: false, record: r };
      }
      const id = crypto.randomUUID(),
        now = Date.now(),
        { params: _params, ...identity } = args;
      const record: CallRecord = {
        ...identity,
        id,
        principal: auth.principal,
        digest: hash,
        rpc_status: 'pending',
        created_at: now,
        updated_at: now,
      };
      if (args.tracking === 'thread_turn')
        record.task = {
          id,
          request_id: args.request_id,
          connection_id: args.connection_id,
          hostId: String(args.params.hostId ?? 'local'),
          threadId: String(args.params.threadId),
          turnId: null,
          state: 'reserved',
        };
      // The selected entry point may send to another native host. Only connectors
      // authorized for this request may supply its hidden attribution metadata.
      if (record.task && record.task.hostId !== 'local')
        record.attribution_connections = [...auth.devices];
      await tx.put(key, id);
      await tx.put(callKey(id), record);
      return { created: true, record };
    });
    if (!reserved.created) return this.invoke(auth, 'get_request', { request_id: args.request_id });
    const r = reserved.record;
    this.inFlight.add(r.id);
    let reply: Outcome;
    try {
      reply = await this.dispatch('call', { ...args, ...(r.task ? { task: r.task } : {}) }, r.id);
    } finally {
      this.inFlight.delete(r.id);
    }
    await this.recordReply(r.id, reply);
    let latest = (await this.store.get<CallRecord>(callKey(r.id)))!;
    // Establish observation once after dispatch. There is no heartbeat/restart restore path.
    if (latest.task && latest.rpc_status === 'returned')
      latest = await this.readTask(latest, auth.devices);
    return this.public(latest, reply.ok ? (reply.result as any).native : undefined);
  }
  async recordReply(
    id: string,
    reply: Outcome,
    source?: { connection: string; runtimes: string[] },
  ) {
    await this.store.transaction(async (tx) => {
      const r = await tx.get<CallRecord>(callKey(id));
      if (r) {
        if (
          source &&
          (r.connection_id !== source.connection || !source.runtimes.includes(r.runtime_id))
        )
          throw new BridgeError('REPLY_SOURCE_MISMATCH');
        const result = reply.ok ? (reply.result as any) : undefined;
        const next = reply.ok
          ? result.rpc_status
          : unsent.has(reply.error.code)
            ? 'rejected'
            : 'unknown';
        // A timeout or stale report cannot erase a native reply already observed by the DO.
        if (!['returned', 'error', 'rejected'].includes(r.rpc_status)) {
          r.rpc_status = ['returned', 'error', 'rejected', 'unknown'].includes(next)
            ? next
            : 'unknown';
          r.diagnostic = reply.ok ? result.diagnostic : reply.error;
          r.updated_at = Date.now();
        }
        if (r.task) {
          if (result?.observation) await this.mergeTurn(tx, r, result.observation);
          else if (!reply.ok && (r.rpc_status === 'rejected' || !r.task.turnId))
            await this.mergeTurn(tx, r, {
              task_id: r.id,
              state: r.rpc_status === 'rejected' ? 'rejected' : 'unknown',
              turnId: null,
              diagnostic: reply.error,
            });
        }
        await tx.put(callKey(id), r);
        return;
      }
      const key = await tx.get<string>('state:answer-dispatch:' + id);
      const answer = key && (await tx.get<Answer>(answerKey(key)));
      if (!answer || answer.dispatchId !== id || answer.status === 'resolved') return;
      if (
        source &&
        (answer.route.connection_id !== source.connection ||
          !source.runtimes.includes(answer.route.runtime_id))
      )
        throw new BridgeError('REPLY_SOURCE_MISMATCH');
      if (!['responding', 'unknown'].includes(answer.status)) return;
      const result = reply.ok ? (reply.result as any) : undefined;
      answer.status = reply.ok
        ? ['submitted', 'resolved', 'rejected', 'unknown'].includes(result.response_status)
          ? result.response_status
          : 'unknown'
        : unsent.has(reply.error.code)
          ? 'rejected'
          : 'unknown';
      answer.diagnostic = reply.ok ? result.diagnostic : reply.error;
      await tx.put(answerKey(key as string), answer);
    });
    await this.events.wake();
  }
  async mergeTurn(tx: Store, r: CallRecord, o: TurnObservation) {
    if (!r.task || o.task_id !== r.id) throw new BridgeError('TRACKING_ID_MISMATCH');
    const old = r.task;
    if (r.diagnostic?.code === 'TURN_ID_CONFLICT') return;
    if (old.turnId && o.turnId && old.turnId !== o.turnId)
      throw new BridgeError('TURN_ID_CONFLICT');
    if (terminal(old.state)) return;
    // Dispatch receipt may arrive after the watcher has already located the turn.
    if (old.turnId && !o.turnId && ['accepted', 'reserved', 'unknown'].includes(o.state)) return;
    const changed = old.state !== o.state || (!old.turnId && !!o.turnId);
    r.task = { ...old, state: o.state, turnId: old.turnId ?? o.turnId, error: o.error ?? null };
    r.diagnostic = o.diagnostic ?? undefined;
    r.updated_at = Date.now();
    await tx.put(callKey(r.id), r);
    if (changed)
      await this.events.record(tx, r.connection_id, [
        {
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
        },
      ]);
  }
  async observe(connection: string, observations: Observation[]) {
    const ids = await this.store.transaction(async (tx) => {
      const ids: string[] = [];
      for (const o of observations) {
        if (o.kind === 'turn') {
          const r = await tx.get<CallRecord>(callKey(o.task_id));
          if (!r || r.connection_id !== connection) throw new BridgeError('TRACKING_ID_MISMATCH');
          await this.mergeTurn(tx, r, o);
        } else {
          if (o.notice.data.connection_id !== connection)
            throw new BridgeError('EVENT_SOURCE_MISMATCH');
          const d = o.notice.data;
          if (d.interaction_key && d.status === 'resolved') {
            const k = answerKey(canonical([connection, d.interface, d.interaction_key]));
            const a = await tx.get<Answer>(k);
            if (a) {
              a.status = 'resolved';
              await tx.put(k, a);
            }
          }
          await this.events.record(tx, connection, [o.notice]);
        }
        ids.push(o.id);
      }
      return ids;
    });
    await this.events.wake();
    return ids;
  }
  async readTask(record: CallRecord, allowed: string[]) {
    const r = await this.resolveAttribution(record, allowed);
    if (!terminal(r.task!.state)) {
      const reply = await this.dispatch('read_turn', {
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
  }
  async resolveAttribution(record: CallRecord, allowed?: string[]): Promise<CallRecord> {
    if (
      !record.task ||
      record.task.turnId ||
      terminal(record.task.state) ||
      !record.attribution_connections ||
      record.diagnostic?.code === 'TURN_ID_CONFLICT'
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
          this.dispatch('resolve_turn', {
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
      return this.store.transaction(async (tx) => {
        const current = (await tx.get<CallRecord>(callKey(record.id)))!;
        if (!current.task || current.task.turnId || terminal(current.task.state)) return current;
        const conflict =
          ids.size > 1 || replies.some((r) => !r.ok && r.error.code === 'TURN_ID_CONFLICT');
        if (conflict) {
          current.task.state = 'unknown';
          current.diagnostic = { code: 'TURN_ID_CONFLICT' };
          await tx.put(callKey(current.id), current);
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
          await tx.put(callKey(current.id), current);
        } else {
          await this.mergeTurn(tx, current, {
            task_id: current.id,
            state: 'unknown',
            turnId: null,
            diagnostic: { code: 'TURN_ATTRIBUTION_PENDING' },
          });
        }
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
  async resolveInteraction(key: string) {
    await this.store.transaction(async (tx) => {
      const a = await tx.get<Answer>(answerKey(key));
      if (a) {
        a.status = 'resolved';
        await tx.put(answerKey(key), a);
      }
    });
  }
  async respond(auth: Authority, args: { event_id: string; response: NativeResponse }) {
    const route = await this.store.get<ResponseRoute>(eventKey(auth.principal, args.event_id));
    if (!route)
      throw new BridgeError('EVENT_NOT_FOUND', 'Read the current event before responding');
    this.authorize(auth, route.connection_id);
    const hash = await digest(args.response);
    const { created, answer } = await this.store.transaction(async (tx) => {
      const previous = await tx.get<Answer>(answerKey(route.key));
      if (previous && previous.status !== 'rejected') {
        if (previous.digest !== hash) throw new BridgeError('IDEMPOTENCY_CONFLICT');
        return { created: false, answer: previous };
      }
      const answer: Answer = {
        route,
        digest: hash,
        dispatchId: crypto.randomUUID(),
        status: 'responding',
      };
      await tx.put(answerKey(route.key), answer);
      await tx.put('state:answer-dispatch:' + answer.dispatchId, route.key);
      return { created: true, answer };
    });
    if (created) {
      this.inFlight.add(answer.dispatchId);
      try {
        const reply = await this.dispatch('respond', { ...route, ...args }, answer.dispatchId);
        await this.recordReply(answer.dispatchId, reply);
      } finally {
        this.inFlight.delete(answer.dispatchId);
      }
    } else if (answer.status === 'responding' && !this.inFlight.has(answer.dispatchId)) {
      await this.recordReply(answer.dispatchId, {
        ok: false,
        error: { code: 'DISPATCH_OUTCOME_UNKNOWN' },
      });
    }
    const current = (await this.store.get<Answer>(answerKey(route.key)))!;
    return {
      event_id: args.event_id,
      response_status: current.status,
      ...(current.diagnostic ? { diagnostic: current.diagnostic } : {}),
    };
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
