import { HttpError } from '../http/responses.ts';
import type { AtomicStore, Store } from '../hub/storage.ts';
import type { ResponseRoute } from '@dotx/shared/wire/observations';
import { requestKey, answerKey, digest } from './records.ts';
import type { CallRecord, Answer } from './records.ts';

interface Group {
  created_at: number;
  keys: string[];
}
interface Backfill {
  phase: number;
  cursor?: string;
  started_at: number;
}
const day = 86_400_000;
const batchSize = 100;
const groupKey = (id: string) => 'retention:group:' + id;
const indexPrefix = 'retention:created:';
const indexKey = (at: number, id: string) => indexPrefix + String(at).padStart(16, '0') + ':' + id;
const backfillKey = 'retention:backfill';
const legacyPrefixes = ['state:call:', 'state:event:', 'state:answer:', 'state:answer-dispatch:'];
export const callGroup = (id: string) => 'call:' + id;
export const interactionGroup = async (key: string) => 'interaction:' + (await digest(key));

// Creation-time ordering lets a new retention setting apply to existing data
// without rewriting every expiry or business record.
export class Retention {
  readonly store: AtomicStore;
  readonly days: number;
  readonly milliseconds: number;
  private readonly held = new Map<string, number>();
  constructor(store: AtomicStore, configured?: string) {
    this.store = store;
    this.days = Number(configured ?? 30);
    this.milliseconds = this.days * day;
    if (
      !Number.isFinite(this.days) ||
      this.days <= 0 ||
      this.milliseconds < 1 ||
      !Number.isSafeInteger(Math.ceil(Date.now() + this.milliseconds))
    )
      throw new HttpError(
        503,
        'INVALID_RECORD_RETENTION_DAYS',
        'RECORD_RETENTION_DAYS must be a positive number of days within the timestamp range.',
      );
  }
  expiresAt(created: number) {
    return Math.ceil(created + this.milliseconds);
  }
  async wake(tx: Store, at: number) {
    const next = await tx.getAlarm();
    if (next === null || next > at) await tx.setAlarm(at);
  }
  async initialize() {
    await this.store.transaction(async (tx) => {
      if ((await tx.get<number>('retention:days')) === this.days) return;
      await tx.put('retention:days', this.days);
      if (!(await tx.get<Backfill>(backfillKey)))
        await tx.put(backfillKey, { phase: 0, started_at: Date.now() } satisfies Backfill);
      await this.wake(tx, Date.now() + 1);
    });
  }
  async register(tx: Store, id: string, keys: string[], created = Date.now()) {
    const previous = await tx.get<Group>(groupKey(id));
    const group = previous ?? { created_at: created, keys: [] };
    const additions = keys.filter((key) => !group.keys.includes(key));
    if (!previous || additions.length) {
      group.keys.push(...additions);
      await tx.put(groupKey(id), group);
    }
    if (!previous) await tx.put(indexKey(group.created_at, id), id);
    const expires = this.expiresAt(group.created_at);
    await this.wake(tx, Math.max(Date.now() + 1, expires));
    return expires;
  }
  async expires(id: string) {
    const group = await this.store.get<Group>(groupKey(id));
    return group ? this.expiresAt(group.created_at) : undefined;
  }
  async hold<T>(id: string, work: () => Promise<T>): Promise<T> {
    this.held.set(id, (this.held.get(id) ?? 0) + 1);
    try {
      return await work();
    } finally {
      const remaining = this.held.get(id)! - 1;
      if (remaining) this.held.set(id, remaining);
      else {
        this.held.delete(id);
        const expires = await this.expires(id);
        if (expires !== undefined && expires <= Date.now())
          await this.store.transaction((tx) => this.wake(tx, Date.now() + 1));
      }
    }
  }
  // Older development builds have no index. Calls keep their original age;
  // interactions without timestamps start their retention at adoption.
  private async backfill() {
    await this.store.transaction(async (tx) => {
      const state = await tx.get<Backfill>(backfillKey);
      if (!state || state.phase >= legacyPrefixes.length) return;
      const records = await tx.list<any>({
        prefix: legacyPrefixes[state.phase]!,
        startAfter: state.cursor,
        limit: batchSize,
      });
      for (const [key, value] of records) {
        if (state.phase === 0) {
          const r = value as CallRecord;
          await this.register(
            tx,
            callGroup(r.id),
            [key, requestKey(r.principal, r.request_id)],
            r.created_at,
          );
        } else if (state.phase === 1) {
          const r = value as ResponseRoute;
          await this.register(tx, await interactionGroup(r.key), [key], state.started_at);
        } else if (state.phase === 2) {
          const a = value as Answer;
          await this.register(
            tx,
            await interactionGroup(a.route.key),
            [key, 'state:answer-dispatch:' + a.dispatchId],
            state.started_at,
          );
        } else {
          const answer = await tx.get<Answer>(answerKey(value));
          if (answer)
            await this.register(
              tx,
              await interactionGroup(answer.route.key),
              [key],
              state.started_at,
            );
          else await tx.delete(key);
        }
        state.cursor = key;
      }
      if (records.size < batchSize) {
        state.phase++;
        delete state.cursor;
      }
      await tx.put(backfillKey, state);
      if (state.phase < legacyPrefixes.length) await this.wake(tx, Date.now() + 1000);
    });
  }
  async alarm() {
    await this.backfill();
    await this.store.transaction(async (tx) => {
      const entries = await tx.list<string>({ prefix: indexPrefix, limit: batchSize });
      const now = Date.now();
      let next = Infinity;
      let removed = 0;
      for (const [key, id] of entries) {
        const group = await tx.get<Group>(groupKey(id));
        if (!group) {
          await tx.delete(key);
          removed++;
          continue;
        }
        const expires = this.expiresAt(group.created_at);
        if (expires > now) {
          next = Math.min(next, expires);
          break;
        }
        if (this.held.has(id)) {
          next = Math.min(next, now + 60_000);
          continue;
        }
        for (const member of group.keys) await tx.delete(member);
        await tx.delete(groupKey(id));
        await tx.delete(key);
        removed++;
      }
      if (entries.size === batchSize && removed) next = Math.min(next, now + 1000);
      if (Number.isFinite(next)) await this.wake(tx, next);
    });
  }
}
