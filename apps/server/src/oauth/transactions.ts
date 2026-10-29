import type { AuthRequest, ConsentDescription } from '@cloudflare/workers-oauth-provider';
import type { AgentAuthorizationRequest, ConsentContext } from '@dotx/shared/http/consent';
import { HttpError } from '../http/responses.ts';
import { sameSecret } from '../http/crypto.ts';
import type { AtomicStore, Store } from '../hub/storage.ts';
import type { Agents } from '../hub/agents.ts';
interface Transaction {
  binding: string;
  created_at: number;
  expires_at: number;
  request: AuthRequest;
  description: ConsentDescription;
  phase: AgentAuthorizationRequest['phase'];
  agent_id?: string;
  redirect?: string;
}
const key = (id: string) => 'consent:' + id;
function summary(id: string, record: Transaction): AgentAuthorizationRequest {
  return {
    transaction: id,
    created_at: record.created_at,
    expires_at: record.expires_at,
    phase: record.phase,
    client_name: record.description.clientName,
    client_domain: record.description.clientDomain || null,
    redirect_uri: record.request.redirectUri,
    redirect_is_loopback: record.description.redirectIsLoopback,
    agent_id: record.agent_id ?? null,
  };
}
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
      created_at: Date.now(),
      expires_at: Date.now() + 600_000,
      phase: 'waiting',
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
  async read(id: string, tx: Store = this.store) {
    const record = await tx.get<Transaction>(key(id));
    if (!record || record.expires_at <= Date.now())
      throw new HttpError(
        400,
        'AUTHORIZATION_EXPIRED',
        'Return to your Personal Agent to start authorization again.',
      );
    if (
      record.agent_id &&
      record.phase !== 'cancelled' &&
      !(await this.agents.authorizationValid(record.agent_id, tx))
    )
      throw new HttpError(
        409,
        'AUTHORIZATION_REMOVED',
        'This authorization was removed or expired. Restart from your client.',
      );
    return record;
  }
  async browser(id: string, binding: string, tx: Store = this.store) {
    const record = await this.read(id, tx);
    if (!sameSecret(record.binding, binding)) throw new HttpError(400, 'AUTHORIZATION_EXPIRED');
    return record;
  }
  async context(id: string, binding: string): Promise<ConsentContext> {
    return { ...summary(id, await this.browser(id, binding)), service_name: 'DotX' };
  }
  async list() {
    const result: AgentAuthorizationRequest[] = [];
    for (const [entry, record] of await this.store.list<Transaction>({ prefix: 'consent:' })) {
      if (record.expires_at > Date.now() && record.phase === 'waiting')
        result.push(summary(entry.slice('consent:'.length), record));
    }
    return result.sort((a, b) => b.created_at - a.created_at);
  }
  async inspect(id: string) {
    return summary(id, await this.read(id));
  }
  async approve(id: string, name?: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.read(id, tx);
      if (record.phase !== 'waiting') throw new HttpError(409, 'AUTHORIZATION_STATE_CHANGED');
      Object.assign(
        record,
        await this.agents.approve(
          id,
          record.expires_at,
          name?.trim() || record.description.clientName,
          tx,
        ),
        { phase: 'approved' },
      );
      await tx.put(key(id), record);
      return summary(id, record);
    });
  }
  async reject(id: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.read(id, tx);
      if (record.phase !== 'waiting') throw new HttpError(409, 'AUTHORIZATION_STATE_CHANGED');
      record.phase = 'cancelled';
      await tx.put(key(id), record);
      return summary(id, record);
    });
  }
  async reserve(id: string, binding: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.browser(id, binding, tx);
      if (record.phase === 'complete') return record;
      if (record.phase === 'signing')
        throw new HttpError(
          409,
          'AUTHORIZATION_INTERRUPTED',
          'Authorization is in progress or could not be recovered. Check the client; restart authorization if needed.',
        );
      if (record.phase !== 'approved') throw new HttpError(409, 'AUTHORIZATION_NOT_APPROVED');
      record.phase = 'signing';
      await tx.put(key(id), record);
      return record;
    });
  }
  async complete(id: string, binding: string, redirect: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.browser(id, binding, tx);
      if (record.phase !== 'signing') throw new HttpError(409, 'AUTHORIZATION_STATE_CHANGED');
      record.phase = 'complete';
      record.redirect = redirect;
      await tx.put(key(id), record);
      return redirect;
    });
  }
  async cancel(id: string, binding: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.browser(id, binding, tx);
      if (record.phase === 'complete') return record.redirect!;
      if (record.phase === 'signing') throw new HttpError(409, 'AUTHORIZATION_STATE_CHANGED');
      if (record.agent_id) await this.agents.cancelAuthorization(record.agent_id, id, tx);
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
