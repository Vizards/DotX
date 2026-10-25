import { BridgeError } from '@dotx/shared/errors';
import { gatewaySchemas } from '../mcp/schemas.ts';
import type { Call } from '@dotx/shared/wire/commands';
import type { GatewayOperation } from '../mcp/schemas.ts';
import type { Outcome } from '@dotx/shared/requests';
import { terminal, trackedTarget } from '@dotx/shared/requests';
import type { AtomicStore } from '../hub/storage.ts';
import type { Events } from '../events/subscriptions.ts';

import {
  Records,
  requestKey,
  callKey,
  digest,
  unwrap,
  type Authority,
  type CallRecord,
  type Dispatch,
} from './records.ts';
import { Turns } from './turns.ts';
import { Interactions } from './interactions.ts';
import { callGroup } from './retention.ts';
// One-call orchestration; durable records and native correlation have separate owners.
export class Coordinator {
  readonly store: AtomicStore;
  readonly dispatch: Dispatch;
  readonly records: Records;
  readonly turns: Turns;
  readonly interactions: Interactions;
  constructor(
    store: AtomicStore,
    dispatch: Dispatch,
    events: Events,
    allowed: Records['allowed'],
    retentionDays?: string,
  ) {
    this.store = store;
    this.dispatch = dispatch;
    this.records = new Records(store, events, allowed, retentionDays);
    this.turns = new Turns(this.records, dispatch);
    this.interactions = new Interactions(this.records, dispatch);
  }
  authorize(auth: Authority, connection: string) {
    if (!auth.devices.includes(connection)) throw new BridgeError('CONNECTION_NOT_AUTHORIZED');
  }
  async invoke(auth: Authority, operation: GatewayOperation, input: unknown): Promise<any> {
    if (operation === 'get_request') {
      const { request_id } = gatewaySchemas.get_request.parse(input);
      const id = await this.store.get<string>(requestKey(auth.principal, request_id));
      if (!id) throw new BridgeError('REQUEST_NOT_FOUND');
      return this.records.retention.hold(callGroup(id), async () => {
        let r = await this.store.get<CallRecord>(callKey(id));
        if (!r) throw new BridgeError('REQUEST_NOT_FOUND');
        this.authorize(auth, r.connection_id);
        if (r.rpc_status === 'pending' && !this.records.inFlight.has(r.id)) {
          await this.records.recordReply(r.id, {
            ok: false,
            error: { code: 'DISPATCH_OUTCOME_UNKNOWN' },
          });
        }
        let result: unknown;
        let resultError: unknown;
        if (r.task && r.task.state !== 'rejected') {
          r = await this.turns.readTask(r, auth.devices);
          if (r.task!.turnId && terminal(r.task!.state)) {
            // A remote host's files belong to its own connector, not the original entry point.
            const connection = r.result_connection_id ?? r.connection_id;
            this.authorize(auth, connection);
            const reply = await this.dispatch(auth.principal, 'read_turn_result', {
              connection_id: connection,
              interface: 'app_server',
              task: r.task,
            });
            if (reply.ok) result = reply.result;
            else resultError = reply.error;
          }
        }
        return {
          ...this.records.public(
            (await this.store.get<CallRecord>(callKey(r.id)))!,
            undefined,
            result,
          ),
          ...(resultError === undefined ? {} : { result_error: resultError }),
        };
      });
    }
    if (operation === 'respond')
      return this.interactions.respond(auth, gatewaySchemas.respond.parse(input));
    const args = gatewaySchemas[operation].parse(input);
    this.authorize(auth, args.connection_id);
    if (operation === 'call') return this.call(auth, args as Call);
    const result = unwrap(await this.dispatch(auth.principal, operation, args));
    if (operation === 'read_events') await this.interactions.read(auth, args, result);
    return result;
  }
  async call(auth: Authority, args: Call) {
    const requestId = args.request_id;
    if (args.tracking === 'thread_turn' && !requestId)
      throw new BridgeError('REQUEST_ID_REQUIRED', 'thread_turn tracking requires request_id');
    // Unidentified RPCs have only an in-flight transport ID, never a durable receipt.
    if (!requestId) return unwrap(await this.dispatch(auth.principal, 'call', args));
    const hash = await digest(args),
      key = requestKey(auth.principal, requestId);
    let target: { hostId?: string; threadId: string } | undefined;
    if (args.tracking === 'thread_turn') {
      if (args.interface !== 'app_tools' || args.method !== 'codex_app.send_message_to_thread')
        throw new BridgeError('TRACKING_NOT_SUPPORTED');
      // Extract only the correlation target; dispatch retains the original params.
      target = trackedTarget.parse(args.params);
    }
    const proposedId = crypto.randomUUID();
    return this.records.retention.hold(callGroup(proposedId), async () => {
      const reserved = await this.store.transaction(async (tx) => {
        await this.records.assertActive(auth.principal, tx);
        const existingId = await tx.get<string>(key);
        if (existingId) {
          const r = (await tx.get<CallRecord>(callKey(existingId)))!;
          if (r.digest !== hash) throw new BridgeError('IDEMPOTENCY_CONFLICT');
          return { created: false, record: r };
        }
        const id = proposedId,
          now = Date.now(),
          { params: _params, ...identity } = args;
        const record: CallRecord = {
          ...identity,
          request_id: requestId,
          id,
          principal: auth.principal,
          digest: hash,
          rpc_status: 'pending',
          created_at: now,
          updated_at: now,
        };
        if (target)
          record.task = {
            id,
            request_id: requestId,
            connection_id: args.connection_id,
            hostId: target.hostId ?? 'local',
            threadId: target.threadId,
            turnId: null,
            state: 'reserved',
          };
        // The selected entry point may send to another native host. Only connectors
        // authorized for this request may supply its hidden attribution metadata.
        if (record.task && record.task.hostId !== 'local')
          record.attribution_connections = [...auth.devices];
        await tx.put(key, id);
        await tx.put(callKey(id), record);
        await this.records.retention.register(tx, callGroup(id), [key, callKey(id)], now);
        return { created: true, record };
      });
      if (!reserved.created)
        return this.invoke(auth, 'get_request', { request_id: args.request_id });
      const r = reserved.record;
      this.records.inFlight.add(r.id);
      try {
        const reply: Outcome = await this.dispatch(
          auth.principal,
          'call',
          { ...args, ...(r.task ? { task: r.task } : {}) },
          r.id,
        );
        await this.records.recordReply(r.id, reply);
        let latest = (await this.store.get<CallRecord>(callKey(r.id)))!;
        // Establish observation once after dispatch. There is no heartbeat/restart restore path.
        if (latest.task && latest.rpc_status === 'returned')
          latest = await this.turns.readTask(latest, auth.devices);
        return this.records.public(latest, reply.ok ? (reply.result as any).native : undefined);
      } finally {
        this.records.inFlight.delete(r.id);
      }
    });
  }
}
