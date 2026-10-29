import type { AgentConnection, PendingPhase } from '@dotx/shared/http/admin';
import { HttpError } from '../http/responses.ts';
import type { AtomicStore, Store } from './storage.ts';
export interface GrantIdentity {
  agent_id: string;
  grant_id: string;
  client_id: string;
}
interface GrantState {
  grant_id: string;
  client_id: string;
  expires_at: number;
  activated_at: number;
  last_seen: number;
}
interface Pending {
  phase: PendingPhase;
  created_at: number;
  expires_at: number;
  transaction: string;
  grant_id?: string;
  client_id?: string;
}
interface AgentRecord {
  agent_id: string;
  name: string;
  created_at: number;
  revoked: boolean;
  active: GrantState | null;
  pending: Pending | null;
}
const agentKey = (id: string) => 'agent:' + id;
const lastSeenInterval = 60_000;
function publicAgent(record: AgentRecord): AgentConnection {
  return {
    agent_id: record.agent_id,
    name: record.name,
    created_at: record.created_at,
    revoked: record.revoked,
    active: record.active
      ? {
          grant_id: record.active.grant_id,
          activated_at: record.active.activated_at,
          last_seen: record.active.last_seen,
        }
      : null,
    pending: record.pending
      ? {
          phase: record.pending.phase,
          created_at: record.pending.created_at,
          expires_at: record.pending.expires_at,
          grant_expires_at: record.pending.grant_id ? record.pending.expires_at : null,
        }
      : null,
  };
}
export class Agents {
  readonly store: AtomicStore;
  constructor(store: AtomicStore) {
    this.store = store;
  }
  async get(id: string, tx?: Store): Promise<AgentRecord> {
    if (!tx) return this.store.transaction((store) => this.get(id, store));
    const record = await tx.get<AgentRecord>(agentKey(id));
    if (!record) throw new HttpError(404, 'AGENT_NOT_FOUND');
    let changed = false;
    if (record.pending && record.pending.expires_at <= Date.now()) {
      const pending = record.pending;
      record.pending = null;
      await this.ended(tx, record, pending.grant_id);
      changed = true;
    }
    if (record.active && record.active.expires_at <= Date.now()) {
      const active = record.active;
      record.active = null;
      await this.ended(tx, record, active.grant_id);
      changed = true;
    }
    if (changed) await tx.put(agentKey(id), record);
    return record;
  }
  async ended(tx: Store, record: AgentRecord, grant?: string) {
    if (grant && record.active?.grant_id !== grant)
      await tx.put('ended-grant:' + record.agent_id + ':' + grant, {
        userId: record.agent_id,
        grantId: grant,
      });
  }
  async list() {
    return this.store.transaction(async (tx) => {
      const result: AgentConnection[] = [];
      for (const record of (await tx.list<AgentRecord>({ prefix: 'agent:' })).values())
        result.push(publicAgent(await this.get(record.agent_id, tx)));
      return result;
    });
  }
  /** Each approved request creates an independent connection. */
  async approve(transaction: string, expiresAt: number, name: string, tx: Store) {
    const record: AgentRecord = {
      agent_id: crypto.randomUUID(),
      name,
      created_at: Date.now(),
      revoked: false,
      active: null,
      pending: {
        phase: 'authorizing',
        created_at: Date.now(),
        expires_at: expiresAt,
        transaction,
      },
    };
    await tx.put(agentKey(record.agent_id), record);
    return { agent_id: record.agent_id };
  }
  async cancelAuthorization(id: string, transaction: string, tx: Store) {
    const record = await this.get(id, tx);
    if (record.pending?.transaction !== transaction) return;
    const grant = record.pending.grant_id;
    record.pending = null;
    await this.ended(tx, record, grant);
    await tx.put(agentKey(id), record);
  }
  async rename(id: string, name: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.get(id, tx);
      record.name = name;
      await tx.put(agentKey(id), record);
      return publicAgent(record);
    });
  }
  async revoke(id: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.get(id, tx);
      const grants = [record.active?.grant_id, record.pending?.grant_id];
      record.active = null;
      record.pending = null;
      record.revoked = true;
      for (const grant of grants) await this.ended(tx, record, grant);
      await tx.put(agentKey(id), record);
      return publicAgent(record);
    });
  }
  async bind(identity: GrantIdentity, expiresAt: number) {
    return this.store.transaction(async (tx) => {
      const record = await this.get(identity.agent_id, tx);
      if (record.revoked) return false;
      if (record.active) {
        if (
          record.active.grant_id !== identity.grant_id ||
          record.active.client_id !== identity.client_id
        )
          return false;
        record.active.expires_at = expiresAt;
        await tx.put(agentKey(record.agent_id), record);
        return true;
      }
      const pending = record.pending;
      if (
        !pending ||
        !pending.transaction ||
        (pending.grant_id && pending.grant_id !== identity.grant_id) ||
        (pending.client_id && pending.client_id !== identity.client_id)
      )
        return false;
      pending.grant_id = identity.grant_id;
      pending.client_id = identity.client_id;
      pending.expires_at = expiresAt;
      pending.phase = 'waiting_connection';
      await tx.put(agentKey(record.agent_id), record);
      return true;
    });
  }
  async valid(identity: GrantIdentity, activate: boolean) {
    return this.store.transaction(async (tx) => {
      let record: AgentRecord;
      try {
        record = await this.get(identity.agent_id, tx);
      } catch {
        return false;
      }
      if (record.revoked) return false;
      if (record.active) {
        if (
          record.active.grant_id !== identity.grant_id ||
          record.active.client_id !== identity.client_id
        )
          return false;
        if (activate && Date.now() - record.active.last_seen >= lastSeenInterval) {
          record.active.last_seen = Date.now();
          await tx.put(agentKey(record.agent_id), record);
        }
        return true;
      }
      const pending = record.pending;
      if (
        !pending ||
        pending.grant_id !== identity.grant_id ||
        pending.client_id !== identity.client_id
      )
        return false;
      if (!activate) return true;
      record.active = {
        ...identity,
        expires_at: pending.expires_at,
        activated_at: Date.now(),
        last_seen: Date.now(),
      };
      record.pending = null;
      await tx.put(agentKey(record.agent_id), record);
      return true;
    });
  }
  async authorizationValid(agent: string, tx?: Store) {
    try {
      const record = await this.get(agent, tx);
      return !record.revoked && Boolean(record.pending || record.active);
    } catch {
      return false;
    }
  }
  async activePrincipal(principal: string, tx?: Store) {
    try {
      const [agent_id, client_id, grant_id] = JSON.parse(principal);
      const record = await this.get(agent_id, tx);
      return (
        !record.revoked &&
        !!record.active &&
        record.active.grant_id === grant_id &&
        record.active.client_id === client_id
      );
    } catch {
      return false;
    }
  }
  async active(identity: GrantIdentity) {
    try {
      const record = await this.get(identity.agent_id);
      return (
        !record.revoked &&
        record.active?.grant_id === identity.grant_id &&
        record.active.client_id === identity.client_id
      );
    } catch {
      return false;
    }
  }
}
