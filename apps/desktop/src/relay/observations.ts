import { randomUUID } from 'node:crypto';
import type { NativeEvent } from '@dotx/shared/gateway';
import type { Observation, TurnObservation } from '@dotx/shared/state';
import type { NoticeData } from '@dotx/shared/events';
const object = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' ? (v as Record<string, any>) : {};
const string = (v: unknown) => (typeof v === 'string' ? v : undefined);

// Bounded memory only. An exit before upload may lose intermediate observations;
// get_request or an explicit follow reads current native state after a gap.
export class Observations {
  readonly queue = new Map<string, Observation>();
  readonly limit: number;
  constructor(limit = 1000) {
    this.limit = limit;
  }
  add(observation: Observation) {
    this.queue.set(observation.id, observation);
    if (this.queue.size > this.limit) this.queue.delete(this.queue.keys().next().value!);
  }
  turn(observation: TurnObservation) {
    this.add({ ...observation, id: randomUUID(), kind: 'turn' });
  }
  native(e: NativeEvent) {
    const p = object(e.native.params),
      method = String(e.native.method ?? '');
    if (!method || /(?:\/delta$|outputDelta$|tokenUsage|\/log|\/progress)/i.test(method)) return;
    const data: NoticeData = {
      connection_id: e.connection_id,
      interface: e.interface,
      runtime_id: e.runtime_id,
      source_event_id: e.event_id,
      read_cursor: Buffer.from(JSON.stringify([e.runtime_id, e.sequence - 1])).toString(
        'base64url',
      ),
      kind: e.kind,
      method,
      host_id: string(p.hostId),
      thread_id: string(p.conversationId ?? p.threadId ?? object(p.thread).id),
      turn_id: string(p.turnId ?? object(p.turn).id),
      interaction_key: e.interaction_key ?? string(p.interaction_key),
      status: e.response_status ?? string(p.status ?? object(p.turn).status),
    };
    const emit = (data: NoticeData, suffix: string) => {
      // Stable for retransmission of this in-memory native event/status. The DO's
      // existing event ingress deduplication is sufficient; no second notice ledger.
      const id = `${e.event_id}:${suffix}`;
      this.add({
        id,
        kind: 'notice',
        notice: {
          eventId: id,
          name: 'gateway.native.event',
          timestamp: new Date(e.created_at).toISOString(),
          data,
        },
      });
    };
    if (method === 'thread-stream-state-changed') {
      for (const [index, turn] of (Array.isArray(p.turns) ? p.turns : []).entries()) {
        if (!string(turn.turnId)) continue;
        emit({ ...data, turn_id: turn.turnId, status: string(turn.status) }, String(index));
      }
    } else emit(data, data.status ?? 'event');
  }

  pending(limit = 50) {
    return [...this.queue.values()].slice(0, limit);
  }
  ack(ids: string[]) {
    for (const id of ids) this.queue.delete(id);
  }
}
