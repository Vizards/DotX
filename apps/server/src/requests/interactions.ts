import { BridgeError } from '@dotx/shared/errors';
import { canonical } from '@dotx/shared/wire/commands';
import type { NativeEvent, NativeResponse } from '@dotx/shared/wire/commands';
import { interactionKey } from '@dotx/shared/wire/observations';
import type { ResponseRoute } from '@dotx/shared/wire/observations';
import type { AtomicStore } from '../hub/storage.ts';
import { interactionGroup } from './retention.ts';

import {
  eventKey,
  answerKey,
  digest,
  type Answer,
  type Authority,
  type Dispatch,
  type Records,
} from './records.ts';
export class Interactions {
  readonly records: Records;
  readonly dispatch: Dispatch;
  readonly store: AtomicStore;
  constructor(records: Records, dispatch: Dispatch) {
    this.records = records;
    this.dispatch = dispatch;
    this.store = records.store;
  }
  async read(
    auth: Authority,
    args: { connection_id: string; interface?: string; runtime_id?: string },
    result: { events: NativeEvent[] },
  ) {
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
      await this.store.transaction(async (tx) => {
        await this.records.assertActive(auth.principal, tx);
        const key = eventKey(auth.principal, e.event_id);
        if (canonical(await tx.get<ResponseRoute>(key)) !== canonical(route))
          await tx.put(key, route);
        await this.records.retention.register(tx, await interactionGroup(route.key), [key]);
      });
      const answer = await this.store.get<Answer>(answerKey(route.key));
      if (answer) {
        if (e.response_status === 'resolved') {
          await this.resolveInteraction(route.key);
          answer.status = 'resolved';
        }
        if (answer.status !== 'rejected') e.response_status = answer.status;
        e.response_diagnostic = answer.diagnostic ?? e.response_diagnostic;
      }
    }
  }
  async resolveInteraction(key: string) {
    await this.store.transaction(async (tx) => {
      const a = await tx.get<Answer>(answerKey(key));
      if (a && a.status !== 'resolved') {
        a.status = 'resolved';
        await tx.put(answerKey(key), a);
      }
    });
  }
  async respond(auth: Authority, args: { event_id: string; response: NativeResponse }) {
    const route = await this.store.get<ResponseRoute>(eventKey(auth.principal, args.event_id));
    if (!route)
      throw new BridgeError('EVENT_NOT_FOUND', 'Read the current event before responding');
    if (!auth.devices.includes(route.connection_id))
      throw new BridgeError('CONNECTION_NOT_AUTHORIZED');
    const group = await interactionGroup(route.key);
    return this.records.retention.hold(group, async () => {
      if (!(await this.store.get<ResponseRoute>(eventKey(auth.principal, args.event_id))))
        throw new BridgeError('EVENT_NOT_FOUND', 'Read the current event before responding');
      const hash = await digest(args.response);
      const { created, answer } = await this.store.transaction(async (tx) => {
        await this.records.assertActive(auth.principal, tx);
        const previous = await tx.get<Answer>(answerKey(route.key));
        if (previous && previous.status !== 'rejected') {
          if (previous.digest !== hash) throw new BridgeError('IDEMPOTENCY_CONFLICT');
          return { created: false, answer: previous };
        }
        const answer: Answer = {
          principal: auth.principal,
          route,
          digest: hash,
          dispatchId: crypto.randomUUID(),
          status: 'responding',
        };
        await tx.put(answerKey(route.key), answer);
        await tx.put('state:answer-dispatch:' + answer.dispatchId, route.key);
        await this.records.retention.register(tx, group, [
          answerKey(route.key),
          'state:answer-dispatch:' + answer.dispatchId,
        ]);
        return { created: true, answer };
      });
      if (created) {
        this.records.inFlight.add(answer.dispatchId);
        try {
          const reply = await this.dispatch(
            auth.principal,
            'respond',
            { ...route, ...args },
            answer.dispatchId,
          );
          await this.records.recordReply(answer.dispatchId, reply);
        } finally {
          this.records.inFlight.delete(answer.dispatchId);
        }
      } else if (answer.status === 'responding' && !this.records.inFlight.has(answer.dispatchId)) {
        await this.records.recordReply(answer.dispatchId, {
          ok: false,
          error: { code: 'DISPATCH_OUTCOME_UNKNOWN' },
        });
      }
      const current = (await this.store.get<Answer>(answerKey(route.key)))!;
      return {
        event_id: args.event_id,
        response_status: current.status,
        expires_at: await this.records.retention.expires(group),
        ...(current.diagnostic === undefined ? {} : { diagnostic: current.diagnostic }),
      };
    });
  }
}
