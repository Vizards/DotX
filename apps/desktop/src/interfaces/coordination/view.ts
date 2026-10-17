import { createHash } from 'node:crypto';
import { canonical } from '@dotx/shared/gateway';
import type { NativeEvent } from '@dotx/shared/gateway';
import type { FollowTarget } from '@dotx/shared/state';
export type { FollowTarget } from '@dotx/shared/state';
export const targetKey = (t: FollowTarget) => JSON.stringify([t.hostId, t.conversationId]);
export interface Interaction extends FollowTarget {
  key: string;
  kind: 'native_request';
  owner: string;
  turnId: string;
  native: Record<string, any>;
  responseSchema?: unknown;
  status: NonNullable<NativeEvent['response_status']>;
  responseResult?: unknown;
  diagnostic?: { code: string };
}
// A view of the current desktop snapshot, not an execution/answer ledger.
export class CoordinationView {
  readonly following = new Map<string, FollowTarget>();
  readonly interactions = new Map<string, Interaction>();
  follow(target: FollowTarget, following: boolean) {
    if (following) this.following.set(targetKey(target), target);
    else this.following.delete(targetKey(target));
  }
  targets() {
    return [...this.following.values()];
  }
  restore(targets: FollowTarget[]) {
    this.following.clear();
    for (const t of targets) this.follow(t, true);
  }
  get(key: string) {
    return this.interactions.get(key) ?? null;
  }
  forTarget(target: FollowTarget) {
    return [...this.interactions.values()].filter((i) => targetKey(i) === targetKey(target));
  }
  observe(i: Interaction) {
    const prior = this.interactions.get(i.key);
    if (!prior) this.interactions.set(i.key, i);
    else if (prior.status === 'pending') prior.owner = i.owner;
    return this.interactions.get(i.key)!;
  }
  update(key: string, changes: Partial<Interaction>) {
    const row = this.interactions.get(key)!;
    if (row.status === 'resolved') delete changes.status;
    Object.assign(row, changes);
    return row;
  }
  decorate(event: NativeEvent): NativeEvent {
    const current = event.interaction_key && this.get(event.interaction_key);
    return current
      ? {
          ...event,
          response_status: current.status,
          response_result: current.responseResult,
          response_diagnostic: current.diagnostic,
        }
      : event;
  }
}
// Content identity is needed across instances; it is not a signature or release/version gate.
export const identity = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
