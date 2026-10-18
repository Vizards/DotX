import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { canonical } from '@dotx/shared/gateway';
import {
  eventCatalog,
  matchesEvent,
  parseFilter,
  subscribeSchema,
  unsubscribeSchema,
} from '@dotx/shared/events';
import type { Notice, SubscriptionInput } from '@dotx/shared/events';
import type { AtomicStore, Store } from '../hub/storage.ts';
import {
  callbackURL,
  secretBytes,
  postSigned,
  verifyCallback,
  webhookFetch,
  responseDiagnostic,
  responseHeaders,
  beginAttempt,
  transportError,
  CallbackError,
} from './webhook.ts';
import type { WebhookFetch, CallbackAttempt } from './webhook.ts';
import { BridgeError } from '@dotx/shared/errors';
export interface EventStore extends AtomicStore {
  list<T>(options: {
    prefix?: string;
    startAfter?: string;
    limit?: number;
  }): Promise<Map<string, T>>;
  delete(key: string): Promise<unknown>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
}
export interface EventAuthority {
  principal: string;
  devices: string[];
  user_id?: string;
  client_id?: string;
  grant_id?: string;
}
interface History {
  seq: number;
  receivedAt: number;
  event: Notice;
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
  cursor: number;
  revision: string;
  state: 'active' | 'stopped' | 'expired' | 'revoked' | 'failed';
  pending?: { row: History; attempt: number; nextAt: number; lease?: string; leaseUntil?: number };
  delivered: number;
  lastStatus?: number;
  diagnostic?: string;
  responseDiagnostic?: Awaited<ReturnType<typeof responseDiagnostic>>;
  verification?: CallbackAttempt;
  attempts?: CallbackAttempt[];
}
const RETENTION = 7 * 86400000;
const RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000, 15000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
// A claim must outlive the HTTP deadline, with another budget for signing and
// recording its outcome, so an overlapping alarm cannot redeliver an active attempt.
const DELIVERY_LEASE_MS = 2 * DEFAULT_TIMEOUT_MS;
const subKey = (id: string) => 'events:sub:' + id;
const historyKey = (seq: number) => 'events:history:' + String(seq).padStart(16, '0');
const cursor = (seq: number) => `e1:${seq}`;
async function hash(value: unknown) {
  return Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))),
  ).toString('hex');
}
function sequence(value: string | null | undefined, fallback: number) {
  if (value == null) return fallback;
  if (!/^e1:\d+$/.test(value) || !Number.isSafeInteger(Number(value.slice(3))))
    throw new BridgeError('INVALID_EVENT_CURSOR');
  return Number(value.slice(3));
}
export class Events {
  readonly store: EventStore;
  readonly transport: WebhookFetch;
  readonly jurisdiction?: string;
  readonly log: (record: Record<string, unknown>) => void;
  readonly authorized: (auth: EventAuthority, connectionId: string) => Promise<boolean>;
  constructor(
    store: EventStore,
    options: {
      transport?: WebhookFetch;
      authorized: Events['authorized'];
      jurisdiction?: string;
      log?: Events['log'];
    },
  ) {
    this.store = store;
    this.transport = options.transport ?? webhookFetch;
    this.authorized = options.authorized;
    this.jurisdiction = options.jurisdiction;
    this.log = options.log ?? ((record) => console.info(record));
  }
  async wake(at = Date.now() + 50) {
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
  async invoke(auth: EventAuthority, method: string, raw: unknown): Promise<object> {
    if (method === 'events/list') return { events: eventCatalog };
    if (method === 'events/unsubscribe') {
      const input = unsubscribeSchema.parse(raw),
        { id } = await this.identity(auth, input);
      await this.store.transaction(async (tx) => {
        const s = await tx.get<Subscription>(subKey(id));
        if (s)
          await tx.put(subKey(id), {
            ...s,
            state: 'stopped',
            secret: '',
            oldSecret: undefined,
            pending: undefined,
            revision: crypto.randomUUID(),
          });
      });
      return {};
    }
    if (method !== 'events/subscribe') throw new BridgeError('EVENT_METHOD_NOT_FOUND');
    const input = subscribeSchema.parse(raw);
    const { id, args, url } = await this.identity(auth, input);
    secretBytes(input.delivery.secret);
    const start = (await this.store.get<number>('events:sequence')) ?? 0;
    const requested = sequence(input.cursor, start);
    if (requested > start) throw new BridgeError('INVALID_EVENT_CURSOR');
    // Cache by principal+callback+key for five minutes; a rotated key is verified again.
    const verifiedKey =
      'events:verified:' + (await hash([auth.principal, url, input.delivery.secret]));
    let verification: CallbackAttempt | undefined;
    if (((await this.store.get<number>(verifiedKey)) ?? 0) < Date.now()) {
      try {
        verification = await verifyCallback(this.transport, {
          id,
          url,
          secret: input.delivery.secret,
        });
        this.logAttempt(id, verification, 'verified');
      } catch (error) {
        if (error instanceof CallbackError && error.data.attempt)
          this.logAttempt(id, error.data.attempt, 'verification_failed');
        throw error;
      }
      await this.store.put(verifiedKey, Date.now() + 300000);
    }
    const floor = (await this.store.get<number>('events:floor')) ?? 0;
    const result = await this.store.transaction(async (tx) => {
      const previous = await tx.get<Subscription>(subKey(id));
      const active = previous?.state === 'active' && previous.expires > Date.now();
      // Some hosts can refresh a trigger but cannot supply a replay cursor.
      // Retrying a failed subscription must not silently skip its failed event.
      const resume = previous?.state === 'failed' && input.cursor == null;
      const lifetime = Math.max(60000, Math.min(input.ttlMs ?? 86400000, 86400000));
      const s: Subscription = {
        id,
        auth,
        name: input.name,
        arguments: args,
        url,
        secret: input.delivery.secret,
        expires: Date.now() + lifetime,
        revision: crypto.randomUUID(),
        state: 'active',
        cursor: active ? previous.cursor : Math.max(floor, resume ? previous.cursor : requested),
        pending: active ? previous.pending : undefined,
        delivered: previous?.delivered ?? 0,
        verification: verification ?? previous?.verification,
        attempts: previous?.attempts,
      };
      if (active && previous.secret !== s.secret) {
        s.oldSecret = previous.secret;
        s.oldUntil = Date.now() + 300000;
      } else if (active && (previous.oldUntil ?? 0) > Date.now()) {
        s.oldSecret = previous.oldSecret;
        s.oldUntil = previous.oldUntil;
      }
      await tx.put(subKey(id), s);
      return {
        id,
        refreshBefore: new Date(s.expires).toISOString(),
        cursor: cursor(s.cursor),
        truncated: (resume ? previous.cursor : requested) < floor,
      };
    });
    await this.wake();
    return result;
  }
  // Domain state and its notification can commit in one DO transaction.
  async record(tx: Store, connectionId: string, events: Notice[]) {
    let seq = (await tx.get<number>('events:sequence')) ?? 0;
    const ids: string[] = [];
    for (const e of events) {
      if (e.data.connection_id !== connectionId) throw new BridgeError('EVENT_SOURCE_MISMATCH');
      const seen = 'events:seen:' + connectionId + ':' + e.eventId;
      const previous = await tx.get<boolean>(seen);
      if (!previous) {
        await tx.put(historyKey(++seq), {
          seq,
          receivedAt: Date.now(),
          event: e,
        } satisfies History);
        await tx.put(seen, true);
      }
      ids.push(e.eventId);
    }
    await tx.put('events:sequence', seq);
    return ids;
  }
  async ingest(connectionId: string, events: Notice[]) {
    const ids = await this.store.transaction((tx) => this.record(tx, connectionId, events));
    await this.wake();
    return ids;
  }
  async status(auth: EventAuthority) {
    const all = await this.store.list<Subscription>({ prefix: 'events:sub:' });
    return {
      delivery: 'webhook',
      callback_transport: this.transport === webhookFetch ? 'direct' : 'configured',
      hub_jurisdiction: this.jurisdiction ?? null,
      hub_location_hint: null,
      diagnostic_version: 1,
      retry_policy: { max_retries: MAX_ATTEMPTS - 1, delays_ms: RETRY_DELAYS_MS },
      replay_retention_ms: RETENTION,
      subscriptions: [...all.values()]
        .filter((s) => s.auth.principal === auth.principal)
        .map((s) => ({
          id: s.id,
          name: s.name,
          arguments: s.arguments,
          state: s.state,
          refresh_before: new Date(s.expires).toISOString(),
          cursor: cursor(s.cursor),
          delivered: s.delivered,
          pending_event_id: s.pending?.row.event.eventId,
          delivery_attempt: s.pending?.attempt,
          retry_at:
            s.state === 'active' && s.pending
              ? new Date(s.pending.nextAt).toISOString()
              : undefined,
          last_http_status: s.lastStatus,
          diagnostic: s.diagnostic,
          response_diagnostic: s.responseDiagnostic,
          verification: s.verification,
          recent_attempts: s.attempts ?? [],
        })),
    };
  }
  async alarm() {
    const alarmId = crypto.randomUUID();
    let ordinal = 0;
    const all = await this.store.list<Subscription>({ prefix: 'events:sub:' });
    for (const s of all.values()) {
      if (s.state !== 'active') continue;
      let permitted: boolean;
      try {
        permitted = await this.authorized(s.auth, String(s.arguments.connection_id));
      } catch {
        await this.wake(Date.now() + 30000);
        continue;
      }
      if (s.expires <= Date.now() || !permitted) {
        await this.change(s, (next) => {
          next.state = permitted ? 'expired' : 'revoked';
          next.secret = '';
          next.oldSecret = undefined;
          next.pending = undefined;
        });
        continue;
      }
      const floor = (await this.store.get<number>('events:floor')) ?? 0;
      if (s.cursor < floor && !s.pending) {
        await this.change(s, (next) => {
          next.state = 'failed';
          next.diagnostic = 'EVENT_HISTORY_EXPIRED';
          next.secret = '';
          next.oldSecret = undefined;
        });
        continue;
      }
      if (!s.pending) {
        const rows = [
          ...(
            await this.store.list<History>({
              prefix: 'events:history:',
              startAfter: historyKey(s.cursor),
              limit: 100,
            })
          ).values(),
        ];
        const matched = rows.find((r) => matchesEvent(s.name, s.arguments, r.event));
        const advanced = await this.change(s, (next) => {
          if (matched) next.pending = { row: matched, attempt: 0, nextAt: Date.now() };
          else if (rows.length) next.cursor = rows.at(-1)!.seq;
        });
        if (!advanced) continue;
        Object.assign(s, advanced);
        if (!s.pending) {
          await this.wake(
            rows.length === 100 ? Date.now() + 50 : Math.min(s.expires, Date.now() + 60000),
          );
          continue;
        }
      }
      const pending = s.pending!;
      const due = Math.max(pending.nextAt, pending.leaseUntil ?? 0);
      if (due > Date.now()) {
        await this.wake(due);
        continue;
      }
      const lease = crypto.randomUUID();
      const claimed = await this.change(s, (next) => {
        next.pending = { ...pending, lease, leaseUntil: Date.now() + DELIVERY_LEASE_MS };
      });
      if (!claimed) continue;
      // Persist lease and recovery alarm before network I/O (a crash may lose the response).
      await this.wake(claimed.pending!.leaseUntil!);
      let status = 0;
      let detail: Subscription['responseDiagnostic'];
      const body = JSON.stringify({ ...pending.row.event, cursor: cursor(pending.row.seq) });
      const trace = await beginAttempt(claimed.url, pending.row.event.eventId, body, 'event');
      Object.assign(trace, {
        alarm_id: alarmId,
        alarm_ordinal: ++ordinal,
        attempt_number: pending.attempt + 1,
        event_age_ms: Date.now() - Date.parse(pending.row.event.timestamp),
        verification_age_ms: claimed.verification
          ? Date.now() - Date.parse(claimed.verification.started_at)
          : undefined,
      });
      const started = Date.now();
      try {
        const response = await postSigned(
          this.transport,
          claimed,
          pending.row.event.eventId,
          body,
          trace,
        );
        status = response.status;
        trace.response = { ...responseHeaders(response), category: 'accepted' };
        if (response.ok) await response.body?.cancel();
        else trace.response = detail = await responseDiagnostic(response);
      } catch (error) {
        trace.transport_error = transportError(error);
        /* Retry the same event, never the original Codex operation. */
      }
      trace.http_status = status;
      trace.duration_ms = Date.now() - started;
      const outcome = await this.store.transaction(async (tx) => {
        const current = await tx.get<Subscription>(subKey(s.id));
        if (!current || current.state !== 'active' || current.pending?.lease !== lease) return;
        current.lastStatus = status;
        current.responseDiagnostic = detail;
        if (status >= 200 && status < 300) {
          trace.outcome = 'accepted';
          current.cursor = pending.row.seq;
          current.delivered++;
          current.pending = undefined;
          current.diagnostic = undefined;
        } else {
          const attempt = pending.attempt + 1;
          // Retry the observed intermittent HTML edge denial. Application/auth
          // 403s remain terminal; only the notification is retried, never a task.
          const edgeDenied = status === 403 && detail?.category === 'edge_denied';
          const retry =
            status === 0 || status === 408 || status === 429 || status >= 500 || edgeDenied;
          if (!retry || attempt >= MAX_ATTEMPTS) {
            trace.outcome = retry ? 'retries_exhausted' : 'permanent_failure';
            current.state = 'failed';
            current.pending = { ...pending, attempt };
            current.secret = '';
            current.oldSecret = undefined;
            current.diagnostic =
              status === 410
                ? 'CALLBACK_GONE'
                : status === 413
                  ? 'PAYLOAD_REJECTED'
                  : 'DELIVERY_FAILED';
          } else {
            trace.outcome = 'retry_scheduled';
            const delay = Math.max(
              RETRY_DELAYS_MS[attempt - 1],
              (detail?.retry_after_seconds ?? 0) * 1000,
            );
            trace.retry_at = new Date(Date.now() + delay).toISOString();
            current.pending = {
              ...pending,
              attempt,
              nextAt: Date.now() + delay,
            };
          }
        }
        current.attempts = [...(current.attempts ?? []), trace].slice(-12);
        await tx.put(subKey(s.id), current);
        return trace.outcome;
      });
      // Emit after the transaction: retries of a transaction must not duplicate logs.
      this.logAttempt(s.id, trace, outcome ?? 'superseded');
      await this.wake();
    }
    await this.cleanup();
  }
  logAttempt(id: string, trace: CallbackAttempt, outcome: string) {
    // CallbackAttempt contains only bounded diagnostics, never callback paths,
    // credentials, signatures, task content or raw response/error text.
    this.log({
      event: 'mcp_callback_attempt',
      diagnostic_version: 1,
      subscription_id: id,
      max_attempts: MAX_ATTEMPTS,
      ...trace,
      outcome,
    });
  }
  async change(s: Subscription, fn: (next: Subscription) => void) {
    return this.store.transaction(async (tx) => {
      const current = await tx.get<Subscription>(subKey(s.id));
      if (!current || current.revision !== s.revision || current.state !== 'active') return null;
      fn(current);
      current.revision = crypto.randomUUID();
      await tx.put(subKey(s.id), current);
      return current;
    });
  }
  async cleanup() {
    const rows = await this.store.list<History>({ prefix: 'events:history:', limit: 100 });
    let removed = 0;
    for (const [key, row] of rows) {
      if (row.receivedAt >= Date.now() - RETENTION) break;
      await this.store.put('events:floor', row.seq);
      await this.store.delete(key);
      await this.store.delete(
        'events:seen:' + row.event.data.connection_id + ':' + row.event.eventId,
      );
      removed++;
    }
    if (rows.size) await this.wake(Date.now() + (removed === 100 ? 50 : 86400000));
    // Expired callback verification proofs contain only hashes and timestamps.
    for (const [key, until] of await this.store.list<number>({ prefix: 'events:verified:' }))
      if (until <= Date.now()) await this.store.delete(key);
  }
}
