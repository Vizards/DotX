import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BridgeError, errorValue } from '@dotx/shared/errors';
import { canonical } from '@dotx/shared/wire/commands';
import type { NativeEvent } from '@dotx/shared/wire/commands';
import type { InterfaceStatus } from '@dotx/shared/devices';
import { EventBuffer } from '../../events/buffer.ts';
import type { FollowTarget } from '@dotx/shared/requests';
export type { FollowTarget } from '@dotx/shared/requests';
import { CoordinationWire, applyStatePatches } from './transport.ts';
import type { WireMessage } from './transport.ts';

const targetSchema = z.object({
  hostId: z.string().min(1).default('local'),
  conversationId: z.string().min(1),
});
export interface FollowState extends FollowTarget {
  owner: string;
  state?: WireMessage;
  revision?: number;
  pendingSnapshot?: Promise<FollowState>;
  snapshotWaiters: Set<{ resolve: (s: FollowState) => void; reject: (e: unknown) => void }>;
}
export function turns(state: WireMessage): WireMessage[] {
  // Private desktop state has live turns and normalized history; App Server thread/read differs.
  const entries = [
    ...(state.turns ?? []),
    ...Object.values(state.turnHistory?.history?.entitiesByKey ?? {}),
  ] as WireMessage[];
  return [...new Map(entries.filter((t) => t.turnId).map((t) => [t.turnId, t])).values()];
}
const turnSummary = (state: WireMessage) => ({
  threadRuntimeStatus: state.threadRuntimeStatus,
  turns: turns(state).map((t) => ({ turnId: t.turnId, status: t.status, error: t.error })),
});

export const targetKey = (t: FollowTarget) => JSON.stringify([t.hostId, t.conversationId]);
export const fTarget = (f: FollowTarget) => ({
  hostId: f.hostId,
  conversationId: f.conversationId,
});
export interface FollowOptions {
  home: string;
  version: string;
  connectionId: string;
  events: EventBuffer;
  onState?: (target: FollowTarget) => void;
  onSnapshot: (f: FollowState, previous?: WireMessage) => void;
  onClear: () => void;
}
export class Follows {
  readonly options: FollowOptions;
  readonly wire: CoordinationWire;
  readonly follows = new Map<string, FollowState>();
  runtimeId = randomUUID();
  ready = false;
  stopped = false;
  diagnostic?: unknown;
  constructor(options: FollowOptions) {
    this.options = options;
    options.events.registerRuntime(this.runtimeId);
    this.wire = new CoordinationWire({
      endpoint: path.join(options.home, 'ipc', 'ipc.sock'),
      onMessage: (m) => this.receive(m),
      onDisconnect: (e) => this.disconnected(e),
    });
    void this.connect().catch(() => {});
  }
  status(): InterfaceStatus {
    return {
      name: 'client_coordination',
      runtime_id: this.runtimeId,
      availability: this.ready ? 'online' : 'unavailable',
      version: this.options.version,
      diagnostic: errorValue(this.diagnostic) ?? null,
    };
  }
  emit(
    native: WireMessage,
    kind: NativeEvent['kind'] = 'notification',
    extra: Partial<NativeEvent> = {},
    noticeNative?: NativeEvent['native'],
  ) {
    return this.options.events.addEvent(
      {
        connection_id: this.options.connectionId,
        interface: 'client_coordination',
        runtime_id: this.runtimeId,
        kind,
        native,
        ...extra,
      },
      noticeNative,
    );
  }
  disconnected(error: Error) {
    if (this.stopped) return;
    this.ready = false;
    this.diagnostic = error;
    this.options.events.expireRuntime(this.runtimeId);
    for (const f of this.follows.values()) for (const w of f.snapshotWaiters) w.reject(error);
    const targets = [...this.follows.values()];
    this.follows.clear();
    for (const target of targets) this.options.onState?.(target);
    this.options.onClear();
    if (!this.stopped) {
      this.emit(
        { method: 'runtime/ended', params: { diagnostic: errorValue(error) } },
        'lifecycle',
      );
      this.runtimeId = randomUUID();
      this.options.events.registerRuntime(this.runtimeId);
    }
  }
  async connect() {
    if (this.stopped) throw new BridgeError('COORDINATION_CLOSED');
    try {
      await this.wire.connect();
      this.ready = true;
      this.diagnostic = undefined;
    } catch (error) {
      this.ready = false;
      this.diagnostic = error;
      throw error;
    }
  }
  invalidate(f: FollowState, error: unknown) {
    f.state = undefined;
    for (const waiter of f.snapshotWaiters) waiter.reject(error);
    this.options.onState?.(f);
    this.emit(
      {
        method: 'subscription/unavailable',
        params: {
          ...fTarget(f),
          diagnostic: errorValue(error),
        },
      },
      'lifecycle',
    );
    // Leave the stream unavailable until an explicit read/follow, without fetching a snapshot.
    if (f.owner) {
      try {
        this.wire.follow(f.hostId, f.conversationId, f.owner, false);
      } catch {}
    }
  }
  async owner(target: FollowTarget) {
    await this.connect();
    const r = await this.wire.request('thread-owner-discovery', target, 1);
    if (r.resultType !== 'success') throw r.error;
    if (typeof r.handledByClientId !== 'string')
      throw { code: 'COORDINATION_OWNER_UNAVAILABLE', response: r };
    return r;
  }
  async snapshot(target: FollowTarget): Promise<FollowState> {
    const key = targetKey(target);
    let f = this.follows.get(key);
    if (f?.pendingSnapshot) return f.pendingSnapshot;
    f ??= { ...target, owner: '', snapshotWaiters: new Set() };
    this.follows.set(key, f);
    const current = f;
    current.pendingSnapshot = (async () => {
      const owner = (await this.owner(target)).handledByClientId;
      if (current.owner && current.owner !== owner) {
        this.wire.follow(target.hostId, target.conversationId, current.owner, false);
        current.state = undefined;
        current.revision = undefined;
      }
      current.owner = owner;
      const received = new Promise<FollowState>((resolve, reject) => {
        const waiter = {
          resolve: (s: FollowState) => {
            clearTimeout(timer);
            current.snapshotWaiters.delete(waiter);
            resolve(s);
          },
          reject: (e: unknown) => {
            clearTimeout(timer);
            current.snapshotWaiters.delete(waiter);
            reject(e);
          },
        };
        const timer = setTimeout(
          () => waiter.reject(new BridgeError('COORDINATION_SNAPSHOT_TIMEOUT')),
          DEFAULT_TIMEOUT_MS,
        );
        current.snapshotWaiters.add(waiter);
      });
      try {
        this.wire.follow(target.hostId, target.conversationId, owner, false);
        this.wire.follow(target.hostId, target.conversationId, owner, true);
      } catch (e) {
        for (const w of current.snapshotWaiters) w.reject(e);
      }
      return received;
    })()
      .catch((error) => {
        this.invalidate(current, error);
        throw error;
      })
      .finally(() => {
        current.pendingSnapshot = undefined;
      });
    return current.pendingSnapshot;
  }
  receive(message: WireMessage) {
    if (message.type !== 'broadcast' || message.method !== 'thread-stream-state-changed') return;
    const target = targetSchema.safeParse(message.params);
    if (!target.success) {
      // Other owners' broadcasts are unrelated. A known owner's unreadable target
      // is a protocol failure; the existing disconnect path exposes it to followers.
      if ([...this.follows.values()].some((f) => f.owner === message.sourceClientId))
        throw new BridgeError('COORDINATION_INVALID_STATE_TARGET', undefined, {
          cause: target.error,
        });
      return;
    }
    const f = this.follows.get(targetKey(target.data));
    if (!f || message.sourceClientId !== f.owner) return;
    // Native state-message revision, NOT a Codex release allowlist. v11 was observed on
    // 26.1007.71326 and rechecked on 26.1013.31256; a new revision needs its shape verified.
    if (message.version !== 11) {
      this.wire.close(
        new BridgeError('COORDINATION_STATE_VERSION_MISMATCH', undefined, {
          cause: { expected: 11, received: message.version },
        }),
      );
      return;
    }
    const change = message.params.change;
    const previous = f.state;
    if (change.type === 'snapshot') {
      if (
        change.conversationState?.id !== f.conversationId ||
        change.conversationState?.hostId !== f.hostId
      )
        throw new BridgeError('COORDINATION_THREAD_IDENTITY_MISMATCH', undefined, {
          cause: {
            expected: fTarget(f),
            received: {
              hostId: change.conversationState?.hostId,
              conversationId: change.conversationState?.id,
            },
          },
        });
      f.state = change.conversationState;
      f.revision = change.revision;
    } else if (change.type === 'patches') {
      if (!f.state || f.revision !== change.baseRevision) {
        this.invalidate(
          f,
          new BridgeError('COORDINATION_REVISION_GAP', undefined, {
            cause: { currentRevision: f.revision, baseRevision: change.baseRevision },
          }),
        );
        return;
      }
      try {
        f.state = applyStatePatches(f.state, change.patches);
        f.revision = change.revision;
      } catch (error) {
        this.invalidate(f, error);
        return;
      }
    } else {
      this.invalidate(
        f,
        new BridgeError('COORDINATION_UNKNOWN_STATE_CHANGE', undefined, {
          cause: { type: change.type },
        }),
      );
      return;
    }
    this.observed(f, change.type === 'snapshot', previous);
    if (change.type === 'snapshot') for (const w of f.snapshotWaiters) w.resolve(f);
  }
  close() {
    this.stopped = true;
    this.ready = false;
    for (const f of this.follows.values())
      for (const w of f.snapshotWaiters) w.reject(new BridgeError('COORDINATION_CLOSED'));
    this.options.events.expireRuntime(this.runtimeId);
    this.follows.clear();
    this.options.onClear();
    this.wire.close();
  }
  observed(f: FollowState, snapshot = false, previous?: WireMessage) {
    this.options.onSnapshot(f, previous);
    const s = f.state!;
    const after = turnSummary(s);
    const summary = { ...fTarget(f), ...after };
    const before = previous && turnSummary(previous);
    const changed = !before || canonical(before) !== canonical(after);
    if (changed) {
      const oldTurns = new Map(before?.turns.map((turn) => [turn.turnId, turn]));
      const runtimeChanged =
        canonical(before?.threadRuntimeStatus) !== canonical(s.threadRuntimeStatus);
      const changedTurns = summary.turns.filter((turn) => {
        const old = oldTurns.get(turn.turnId);
        return (
          canonical(old) !== canonical(turn) ||
          (runtimeChanged && (turn.status === 'inProgress' || old?.status === 'inProgress'))
        );
      });
      const method = 'thread-stream-state-changed';
      this.emit(
        { method, params: summary },
        'notification',
        {},
        {
          method,
          params: { ...summary, turns: changedTurns },
        },
      );
    }
    if (changed || snapshot) this.options.onState?.(f);
  }
}
