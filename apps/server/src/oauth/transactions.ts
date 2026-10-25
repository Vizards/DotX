import type { AuthRequest, ConsentDescription } from '@cloudflare/workers-oauth-provider';
import type { ConsentContext } from '@dotx/shared/http/consent';
import { HttpError } from '../http/responses.ts';
import { sameSecret } from '../http/crypto.ts';
import type { AtomicStore, Store } from '../hub/storage.ts';
import type { Agents } from '../hub/agents.ts';
interface Transaction {
  binding: string;
  expires_at: number;
  request: AuthRequest;
  description: ConsentDescription;
  phase: 'waiting' | 'signing' | 'complete' | 'cancelled';
  agent_id?: string;
  round_id?: string;
  redirect?: string;
  error: { code: string; message: string } | null;
}
const key = (id: string) => 'consent:' + id;
const attemptsKey = 'access-code-attempts';
const attemptWindowMs = 60_000;
const attemptLimit = 10;
export class Transactions {
  readonly store: AtomicStore;
  readonly agents: Agents;
  constructor(store: AtomicStore, agents: Agents) {
    this.store = store;
    this.agents = agents;
  }
  async create(request: AuthRequest, description: ConsentDescription, binding: string) {
    const id = crypto.randomUUID();
    const record: Transaction = {
      request,
      description,
      binding,
      expires_at: Date.now() + 600_000,
      phase: 'waiting',
      error: null,
    };
    await this.store.transaction(async (tx) => {
      let live = 0;
      for (const [entry, value] of await tx.list<Transaction>({ prefix: 'consent:' })) {
        if (value.expires_at <= Date.now()) await tx.delete(entry);
        else live++;
      }
      if (live >= 200)
        throw new HttpError(
          429,
          'AUTHORIZATION_BUSY',
          'Too many unfinished authorizations. Try again later.',
        );
      await tx.put(key(id), record);
    });
    return id;
  }
  async read(id: string, binding: string, tx: Store = this.store) {
    const record = await tx.get<Transaction>(key(id));
    if (!record || record.expires_at <= Date.now() || !sameSecret(record.binding, binding))
      throw new HttpError(
        400,
        'AUTHORIZATION_EXPIRED',
        'Return to your Personal Agent to start authorization again.',
      );
    if (record.phase === 'cancelled') throw new HttpError(400, 'AUTHORIZATION_CANCELLED');
    if (record.agent_id && !(await this.agents.roundValid(record.agent_id, record.round_id!, tx)))
      throw new HttpError(
        409,
        'AUTHORIZATION_REPLACED',
        'This authorization was replaced. Use the newest access code and restart from your client.',
      );
    return record;
  }
  async context(id: string, binding: string): Promise<ConsentContext> {
    const record = await this.read(id, binding);
    return {
      transaction: id,
      expires_at: record.expires_at,
      service_name: 'DotX',
      client_name: record.description.clientName,
      client_domain: record.description.clientDomain || null,
      redirect_uri: record.request.redirectUri,
      redirect_is_loopback: record.description.redirectIsLoopback,
      sharing:
        'This Personal Agent can control every approved Codex on this Server, including devices added later. Each native task keeps its own execution permissions.',
      error: record.error,
    };
  }
  async reserve(id: string, binding: string, code: string) {
    const result = await this.store.transaction(async (tx) => {
      const record = await this.read(id, binding, tx);
      if (record.phase === 'complete') return { record };
      if (record.phase === 'signing')
        throw new HttpError(
          409,
          'AUTHORIZATION_INTERRUPTED',
          'Authorization is in progress or could not be recovered. Check the client; if it cannot continue, reissue the connection’s access code.',
        );
      const now = Date.now();
      let attempts = await tx.get<{ ends_at: number; count: number }>(attemptsKey);
      if (!attempts || attempts.ends_at <= now)
        attempts = { ends_at: now + attemptWindowMs, count: 0 };
      if (attempts.count >= attemptLimit)
        throw new HttpError(
          429,
          'ACCESS_CODE_ATTEMPTS_EXCEEDED',
          `Too many access code attempts on this Server. Try again in ${Math.ceil((attempts.ends_at - now) / 1000)} seconds.`,
          { retry_at: attempts.ends_at },
        );
      attempts.count++;
      await tx.put(attemptsKey, attempts);
      try {
        const identity = await this.agents.consume(code, id, record.expires_at, tx);
        Object.assign(record, identity, { phase: 'signing', error: null });
        await tx.put(key(id), record);
        return { record };
      } catch (error) {
        // Commit unsuccessful guesses too; throwing inside the transaction
        // would roll back their attempt count and allow unlimited retries.
        if (error instanceof HttpError && error.code.startsWith('ACCESS_CODE_')) return { error };
        throw error;
      }
    });
    if (result.error) throw result.error;
    return result.record!;
  }
  async complete(id: string, binding: string, redirect: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.read(id, binding, tx);
      if (record.phase !== 'signing') throw new HttpError(409, 'AUTHORIZATION_STATE_CHANGED');
      record.phase = 'complete';
      record.redirect = redirect;
      await tx.put(key(id), record);
      return record.redirect;
    });
  }
  async error(id: string, binding: string, error: { code: string; message: string }) {
    return this.store.transaction(async (tx) => {
      const record = await this.read(id, binding, tx);
      record.error = error;
      await tx.put(key(id), record);
    });
  }
  async cancel(id: string, binding: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.read(id, binding, tx);
      const callback = new URL(record.request.redirectUri);
      callback.searchParams.set('error', 'access_denied');
      if (record.request.state) callback.searchParams.set('state', record.request.state);
      if (record.request.issuer) callback.searchParams.set('iss', record.request.issuer);
      record.phase = 'cancelled';
      await tx.put(key(id), record);
      return callback.href;
    });
  }
}
