import type { AgentConnection, PendingPhase } from '@dotx/shared/http/admin';
import { HttpError } from '../http/responses.ts';
import { sha256 } from '../http/crypto.ts';
import type { AtomicStore, Store } from './storage.ts';
export interface GrantIdentity {
  agent_id: string;
  round_id: string;
  grant_id: string;
  client_id: string;
}
interface GrantState {
  round_id: string;
  grant_id: string;
  client_id: string;
  expires_at: number;
  activated_at: number;
  last_seen: number;
}
interface Pending {
  round_id: string;
  phase: PendingPhase;
  created_at: number;
  code_expires_at: number;
  expires_at: number;
  code_hash: string;
  transaction?: string;
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
const codeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
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
          round_id: record.pending.round_id,
          phase: record.pending.phase,
          created_at: record.pending.created_at,
          code_expires_at: record.pending.code_expires_at,
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
      await tx.delete('access-code:' + pending.code_hash);
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
  async issue(id?: string, name?: string) {
    const round = crypto.randomUUID(),
      now = Date.now();
    return this.store.transaction(async (tx) => {
      let code: string, hash: string;
      do {
        code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) =>
          codeAlphabet.charAt(byte & 31),
        ).join('');
        hash = await sha256(code);
      } while (await tx.get('access-code:' + hash));
      const record: AgentRecord = id
        ? await this.get(id, tx)
        : {
            agent_id: crypto.randomUUID(),
            name: name!,
            created_at: now,
            revoked: false,
            active: null,
            pending: null,
          };
      if (record.pending) {
        await tx.delete('access-code:' + record.pending.code_hash);
        await this.ended(tx, record, record.pending.grant_id);
      }
      record.revoked = false;
      record.pending = {
        round_id: round,
        phase: 'waiting_code',
        created_at: now,
        code_expires_at: now + 1800_000,
        expires_at: now + 1800_000,
        code_hash: hash,
      };
      await tx.put(agentKey(record.agent_id), record);
      await tx.put('access-code:' + hash, { agent_id: record.agent_id, round_id: round });
      return {
        connection: publicAgent(record),
        access_code: code,
        expires_at: now + 1800_000,
      };
    });
  }
  async rename(id: string, name: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.get(id, tx);
      record.name = name;
      await tx.put(agentKey(id), record);
      return publicAgent(record);
    });
  }
  async cancel(id: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.get(id, tx);
      if (record.pending && record.pending.phase !== 'waiting_code')
        throw new HttpError(409, 'CODE_ALREADY_USED');
      if (record.pending) await tx.delete('access-code:' + record.pending.code_hash);
      record.pending = null;
      await tx.put(agentKey(id), record);
      return publicAgent(record);
    });
  }
  async revoke(id: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.get(id, tx);
      const grants = [record.active?.grant_id, record.pending?.grant_id];
      if (record.pending) await tx.delete('access-code:' + record.pending.code_hash);
      record.active = null;
      record.pending = null;
      record.revoked = true;
      for (const grant of grants) await this.ended(tx, record, grant);
      await tx.put(agentKey(id), record);
      return publicAgent(record);
    });
  }
  async consume(code: string, transaction: string, expiresAt: number, store?: Store) {
    const hash = await sha256(code.trim().toUpperCase());
    const run = async (tx: Store) => {
      const index = await tx.get<{ agent_id: string; round_id: string }>('access-code:' + hash);
      if (!index)
        throw new HttpError(
          400,
          'ACCESS_CODE_INVALID',
          'The access code is invalid, expired or already used.',
        );
      const record = await this.get(index.agent_id, tx),
        pending = record.pending;
      if (
        record.revoked ||
        !pending ||
        pending.round_id !== index.round_id ||
        pending.code_hash !== hash
      )
        throw new HttpError(400, 'ACCESS_CODE_INVALID');
      if (pending.transaction && pending.transaction !== transaction)
        throw new HttpError(400, 'ACCESS_CODE_USED', 'This access code has already been used.');
      if (!pending.transaction && pending.code_expires_at <= Date.now())
        throw new HttpError(400, 'ACCESS_CODE_EXPIRED');
      pending.transaction = transaction;
      pending.phase = 'authorizing';
      pending.expires_at = expiresAt;
      await tx.put(agentKey(record.agent_id), record);
      return { agent_id: record.agent_id, round_id: pending.round_id };
    };
    return store ? run(store) : this.store.transaction(run);
  }
  async bind(identity: GrantIdentity, expiresAt: number) {
    return this.store.transaction(async (tx) => {
      const record = await this.get(identity.agent_id, tx);
      if (record.revoked) return false;
      if (
        record.active?.round_id === identity.round_id &&
        record.active.grant_id === identity.grant_id &&
        record.active.client_id === identity.client_id
      ) {
        record.active.expires_at = expiresAt;
        await tx.put(agentKey(record.agent_id), record);
        return true;
      }
      const pending = record.pending;
      if (
        !pending ||
        pending.round_id !== identity.round_id ||
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
      if (
        record.active?.grant_id === identity.grant_id &&
        record.active.round_id === identity.round_id &&
        record.active.client_id === identity.client_id
      ) {
        if (activate) {
          record.active.last_seen = Date.now();
          await tx.put(agentKey(record.agent_id), record);
        }
        return true;
      }
      const pending = record.pending;
      if (
        !pending ||
        pending.round_id !== identity.round_id ||
        pending.grant_id !== identity.grant_id ||
        pending.client_id !== identity.client_id
      )
        return false;
      if (!activate) return true;
      const old = record.active?.grant_id;
      record.active = {
        ...identity,
        expires_at: pending.expires_at,
        activated_at: Date.now(),
        last_seen: Date.now(),
      };
      record.pending = null;
      await this.ended(tx, record, old);
      await tx.delete('access-code:' + pending.code_hash);
      await tx.put(agentKey(record.agent_id), record);
      return true;
    });
  }
  async roundValid(agent: string, round: string, tx?: Store) {
    try {
      const record = await this.get(agent, tx);
      return (
        !record.revoked && (record.pending?.round_id === round || record.active?.round_id === round)
      );
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
        record.active.round_id === identity.round_id &&
        record.active.client_id === identity.client_id
      );
    } catch {
      return false;
    }
  }
}
