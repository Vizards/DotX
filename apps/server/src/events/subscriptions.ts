import { canonical } from '@dotx/shared/gateway';
import { matchesEvent, parseFilter, subscribeSchema, unsubscribeSchema } from '@dotx/shared/events';
import type { Notice, SubscriptionInput } from '@dotx/shared/events';
import type { AtomicStore, Store } from '../hub/storage.ts';
import {
  callbackURL,
  secretBytes,
  postSigned,
  verifyCallback,
  webhookFetch,
  responseDiagnostic,
  transportError,
  CallbackError,
} from './webhook.ts';
import type { WebhookFetch } from './webhook.ts';
import { BridgeError } from '@dotx/shared/errors';
import { terminal } from '@dotx/shared/state';
export interface EventAuthority {
  principal: string;
  devices: string[];
  user_id?: string;
  client_id?: string;
  grant_id?: string;
}
interface Subscription {
  id: string;
  auth: EventAuthority;
  name: Notice['name'];
  arguments: Record<string, unknown>;
  url: string;
  secret: string;
  oldSecret?: string;
  oldUntil?: number;
  expires: number;
  revision: string;
  ending?: boolean;
}
interface Retry {
  subscriptionId: string;
  revision: string;
  event: Notice;
  attempt: number;
  nextAt: number;
  final?: boolean;
}
export interface EventTurn {
  connection_id: string;
  host_id?: string;
  thread_id?: string;
  turn_id?: string;
  state?: string;
}
const RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000, 15000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const subKey = (id: string) => 'events:sub:' + id;
const retryPrefix = (id: string) => 'events:retry:' + id + ':';
const retryKey = (r: Retry) => retryPrefix(r.subscriptionId) + r.event.eventId;
async function hash(value: unknown) {
  return Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))),
  ).toString('hex');
}
export class Events {
  readonly store: AtomicStore;
  readonly transport: WebhookFetch;
  readonly authorized: (auth: EventAuthority, connectionId: string) => Promise<boolean>;
  readonly waitUntil: (work: Promise<unknown>) => void;
  readonly resolveTurn: (
    auth: EventAuthority,
    args: Record<string, unknown>,
    inspect: boolean,
  ) => Promise<EventTurn>;
  readonly inFlight = new Set<string>();
  constructor(
    store: AtomicStore,
    options: {
      transport?: WebhookFetch;
      authorized: Events['authorized'];
      waitUntil: Events['waitUntil'];
      resolveTurn: Events['resolveTurn'];
    },
  ) {
    this.store = store;
    this.transport = options.transport ?? webhookFetch;
    this.authorized = options.authorized;
    this.waitUntil = options.waitUntil;
    this.resolveTurn = options.resolveTurn;
  }
  async wake(at: number) {
    const next = await this.store.getAlarm();
    if (next === null || next > at) await this.store.setAlarm(at);
  }
  async identity(
    auth: EventAuthority,
    input: Pick<SubscriptionInput, 'name' | 'arguments'> & { delivery: { url: string } },
  ) {
    const args = parseFilter(input.name, input.arguments);
    if (
      !auth.devices.includes(args.connection_id) ||
      !(await this.authorized(auth, args.connection_id))
    )
      throw new BridgeError('CONNECTION_NOT_AUTHORIZED');
    const url = callbackURL(input.delivery.url);
    const id = 'sub_' + (await hash([auth.principal, url, input.name, args]));
    return { id, args, url };
  }
  async clearRetries(tx: Store, id: string) {
    for (const key of (await tx.list({ prefix: retryPrefix(id) })).keys()) await tx.delete(key);
  }
  async invoke(auth: EventAuthority, method: string, raw: unknown): Promise<object> {
    if (method === 'events/unsubscribe') {
      const input = unsubscribeSchema.parse(raw),
        { id } = await this.identity(auth, input);
      await this.store.transaction(async (tx) => {
        await tx.delete(subKey(id));
        await this.clearRetries(tx, id);
      });
      return {};
    }
    if (method !== 'events/subscribe') throw new BridgeError('EVENT_METHOD_NOT_FOUND');
    const input = subscribeSchema.parse(raw);
    const { id, args, url } = await this.identity(auth, input);
    const current = await this.store.get<Subscription>(subKey(id));
    if (current?.ending) throw new BridgeError('SUBSCRIPTION_TURN_ENDED');
    secretBytes(input.delivery.secret);
    // Cache by principal+callback+key for five minutes; a rotated key is verified again.
    const verifiedKey =
      'events:verified:' + (await hash([auth.principal, url, input.delivery.secret]));
    if (((await this.store.get<number>(verifiedKey)) ?? 0) < Date.now()) {
      try {
        await verifyCallback(this.transport, { id, url, secret: input.delivery.secret });
      } catch (error) {
        if (error instanceof CallbackError)
          console.warn({
            event: 'mcp_callback_verification_failed',
            subscription_id: id,
            ...error.data,
          });
        throw error;
      }
      await this.store.put(verifiedKey, Date.now() + 300000);
    }
    // Verification can take time; inspect admission afterwards, not before it.
    // No completed-subscription tombstones: use the existing receipt/native state.
    const turn = await this.resolveTurn(auth, args, true);
    if (turn.state && terminal(turn.state))
      throw new BridgeError(
        'SUBSCRIPTION_TURN_ENDED',
        'This turn has ended. Read its result; a later turn needs a new subscription.',
        { cause: turn },
      );
    const expires = await this.store.transaction(async (tx) => {
      const previous = await tx.get<Subscription>(subKey(id));
      if (previous?.ending) throw new BridgeError('SUBSCRIPTION_TURN_ENDED');
      const active = previous && previous.expires > Date.now();
      const lifetime = Math.max(60000, Math.min(input.ttlMs ?? 86400000, 86400000));
      const s: Subscription = {
        id,
        auth,
        name: input.name,
        arguments: args,
        url,
        secret: input.delivery.secret,
        expires: Date.now() + lifetime,
        // Renewal keeps pending retries. Cancellation/recreation must reject old callbacks.
        revision: active ? previous.revision : crypto.randomUUID(),
      };
      if (!active) await this.clearRetries(tx, id);
      if (active && previous.secret !== s.secret) {
        s.oldSecret = previous.secret;
        s.oldUntil = Date.now() + 300000;
      } else if (active && (previous.oldUntil ?? 0) > Date.now()) {
        s.oldSecret = previous.oldSecret;
        s.oldUntil = previous.oldUntil;
      }
      await tx.put(subKey(id), s);
      return s.expires;
    });
    await this.wake(expires);
    return { id, refreshBefore: new Date(expires).toISOString(), cursor: null, truncated: false };
  }
  // Called only after domain state commits. Initial delivery is best effort: a
  // restart before a failed attempt is saved may lose the notification, not the task.
  publish(events: Notice[]) {
    if (!events.length) return;
    this.waitUntil(
      this.deliver(events).catch((error) => {
        console.warn({ event: 'mcp_notification_failed', error: transportError(error) });
      }),
    );
  }
  async deliver(events: Notice[]) {
    const subscriptions = await this.store.list<Subscription>({ prefix: 'events:sub:' });
    const unique = new Map(events.map((e) => [e.eventId, e]));
    for (const s of subscriptions.values()) {
      if (s.expires <= Date.now() || s.ending) continue;
      let turn: EventTurn;
      try {
        turn = await this.resolveTurn(s.auth, s.arguments, false);
      } catch (error) {
        // A request later used for an ordinary RPC cannot own a turn subscription.
        // Its invalid scope must not prevent delivery to other subscribers.
        console.warn({ event: 'mcp_subscription_scope_failed', error: transportError(error) });
        await this.stop(s);
        continue;
      }
      for (const event of unique.values()) {
        if (!s.auth.devices.includes(event.data.connection_id)) continue;
        const requestMatch =
          typeof s.arguments.request_id === 'string' &&
          event.name === 'gateway.request.updated' &&
          event.data.connection_id === s.arguments.connection_id &&
          event.data.request_id === s.arguments.request_id;
        const nativeMatch =
          event.name === 'gateway.native.event' &&
          event.data.connection_id === turn.connection_id &&
          !!turn.turn_id &&
          event.data.thread_id === turn.thread_id &&
          (event.data.host_id ?? 'local') === (turn.host_id ?? 'local') &&
          (!event.data.turn_id || event.data.turn_id === turn.turn_id);
        const final =
          terminal(event.data.status ?? '') &&
          (requestMatch ||
            (s.name === 'gateway.native.event' &&
              nativeMatch &&
              event.data.turn_id === turn.turn_id &&
              ['thread-stream-state-changed', 'turn/completed', 'turn/failed'].includes(
                event.data.method ?? '',
              )));
        // Scope is mandatory, but thread-level interactions can omit turn_id.
        // Keep the existing method/kind defaults and explicit selectors inside it.
        const { thread_id: _thread, turn_id: _turn, host_id: _host, ...filters } = s.arguments;
        const selected =
          (s.name === 'gateway.request.updated' ? requestMatch : nativeMatch) &&
          matchesEvent(s.name, filters, event);
        if (!selected) {
          if (final) {
            await this.stop(s);
            break;
          }
          continue;
        }
        const r: Retry = {
          subscriptionId: s.id,
          revision: s.revision,
          event,
          attempt: 0,
          nextAt: 0,
          ...(final ? { final: true } : {}),
        };
        // A retry already owns this event; do not reset its attempt budget.
        if (!(await this.store.get(retryKey(r)))) await this.send(r);
        if (final) break;
      }
    }
  }
  async status(auth: EventAuthority) {
    const all = await this.store.list<Subscription>({ prefix: 'events:sub:' });
    const retries = [...(await this.store.list<Retry>({ prefix: 'events:retry:' })).values()];
    return {
      delivery: 'webhook',
      replay: false,
      retry_policy: { max_retries: MAX_ATTEMPTS - 1, delays_ms: RETRY_DELAYS_MS },
      subscriptions: [...all.values()]
        .filter((s) => s.auth.principal === auth.principal)
        .map((s) => ({
          id: s.id,
          name: s.name,
          arguments: s.arguments,
          state: s.ending ? 'ending' : 'active',
          refresh_before: new Date(s.expires).toISOString(),
          cursor: null,
          pending: retries
            .filter((r) => r.subscriptionId === s.id && r.revision === s.revision)
            .map((r) => ({
              event_id: r.event.eventId,
              delivery_attempt: r.attempt,
              retry_at: new Date(r.nextAt).toISOString(),
            })),
        })),
    };
  }
  async stop(s: Subscription, reason?: 'expired' | 'revoked' | 'failed') {
    await this.store.transaction(async (tx) => {
      const current = await tx.get<Subscription>(subKey(s.id));
      if (!current || current.revision !== s.revision) return;
      // An expiry alarm may race a successful renewal.
      if (reason === 'expired' && current.expires > Date.now()) return;
      await tx.delete(subKey(s.id));
      await this.clearRetries(tx, s.id);
    });
  }
  async send(r: Retry) {
    const key = retryKey(r),
      flight = r.revision + ':' + key;
    if (this.inFlight.has(flight)) return;
    this.inFlight.add(flight);
    try {
      const s = await this.store.get<Subscription>(subKey(r.subscriptionId));
      if (!s || s.revision !== r.revision) return;
      if (s.ending && !r.final) return;
      if (s.expires <= Date.now()) {
        await this.stop(s, 'expired');
        return;
      }
      let status = 0;
      let detail: Awaited<ReturnType<typeof responseDiagnostic>> | undefined;
      let transportFailure: ReturnType<typeof transportError> | undefined;
      try {
        if (!(await this.authorized(s.auth, String(s.arguments.connection_id)))) {
          await this.stop(s, 'revoked');
          return;
        }
        const response = await postSigned(
          this.transport,
          s,
          r.event.eventId,
          JSON.stringify({ ...r.event, cursor: null }),
        );
        status = response.status;
        if (response.ok) await response.body?.cancel();
        else detail = await responseDiagnostic(response);
      } catch (error) {
        transportFailure = transportError(error);
      }
      const attempt = r.attempt + 1;
      let outcome = 'accepted';
      if (status >= 200 && status < 300) {
        if (r.final) await this.stop(s);
        else if (r.attempt)
          await this.store.transaction(async (tx) => {
            const current = await tx.get<Retry>(key);
            if (current?.revision === r.revision) await tx.delete(key);
          });
      } else {
        // Retry intermittent HTML edge denials, not application/auth 403s.
        // Only the notification is retried, never the original Codex operation.
        const retry =
          status === 0 ||
          status === 408 ||
          status === 429 ||
          status >= 500 ||
          (status === 403 && detail?.category === 'edge_denied');
        if (!retry || attempt >= MAX_ATTEMPTS) {
          outcome = retry ? 'retries_exhausted' : 'permanent_failure';
          await this.stop(s, 'failed');
        } else {
          const nextAt =
            Date.now() +
            Math.max(RETRY_DELAYS_MS[attempt - 1], (detail?.retry_after_seconds ?? 0) * 1000);
          const saved = await this.store.transaction(async (tx) => {
            const current = await tx.get<Subscription>(subKey(s.id));
            if (!current || current.revision !== r.revision || current.expires <= Date.now())
              return false;
            if (current.ending && !r.final) return false;
            if (r.final && !current.ending) {
              await this.clearRetries(tx, s.id);
              await tx.put(subKey(s.id), { ...current, ending: true });
            }
            await tx.put(key, { ...r, attempt, nextAt } satisfies Retry);
            return true;
          });
          outcome = saved ? 'retry_scheduled' : 'superseded';
          if (saved) await this.wake(nextAt);
        }
      }
      console.info({
        event: 'mcp_callback_delivery',
        subscription_id: s.id,
        event_id: r.event.eventId,
        attempt,
        http_status: status,
        outcome,
        response: detail,
        transport_error: transportFailure,
      });
    } finally {
      this.inFlight.delete(flight);
    }
  }
  async alarm() {
    let expiry = Infinity;
    for (const s of (await this.store.list<Subscription>({ prefix: 'events:sub:' })).values()) {
      if (s.expires <= Date.now()) await this.stop(s, 'expired');
      else expiry = Math.min(expiry, s.expires);
    }
    for (const r of (await this.store.list<Retry>({ prefix: 'events:retry:' })).values()) {
      if (r.nextAt <= Date.now()) await this.send(r);
      else await this.wake(r.nextAt);
    }
    if (Number.isFinite(expiry)) await this.wake(expiry);
    // Expired callback verification proofs contain only hashes and timestamps.
    for (const [key, until] of await this.store.list<number>({ prefix: 'events:verified:' }))
      if (until <= Date.now()) await this.store.delete(key);
  }
}
