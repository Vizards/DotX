import { randomUUID } from 'node:crypto';
import { BridgeError } from '@dotx/shared/errors';
import type { NativeEvent } from '@dotx/shared/gateway';

// Native handles and replay are scoped to this process. Restart cannot recreate old handles.
export class EventBuffer {
  readonly rows: NativeEvent[] = [];
  readonly runtimes = new Set<string>();
  sequence = 0;
  readonly dropped = new Map<string, number>();
  readonly onEvent: (event: NativeEvent) => void;
  readonly limit: number;
  constructor(onEvent: (event: NativeEvent) => void = () => {}, limit = 1000) {
    this.onEvent = onEvent;
    this.limit = limit;
  }
  registerRuntime(id: string) {
    this.runtimes.add(id);
  }
  addEvent(
    input: Omit<NativeEvent, 'event_id' | 'sequence' | 'created_at'>,
    noticeNative?: NativeEvent['native'],
  ) {
    const event = {
      ...input,
      event_id: randomUUID(),
      sequence: ++this.sequence,
      created_at: Date.now(),
    };
    this.rows.push(event);
    if (this.rows.length > this.limit) {
      const removed = this.rows.shift()!;
      if (this.runtimes.has(removed.runtime_id))
        this.dropped.set(removed.runtime_id, removed.sequence);
    }
    // Derived notices may describe only changes; read_events retains the full native payload.
    this.onEvent(noticeNative ? { ...event, native: noticeNative } : event);
    return event;
  }
  event(id: string) {
    return this.rows.find((e) => e.event_id === id) ?? null;
  }
  events(runtime: string, cursor: string | undefined, limit: number) {
    if (!this.runtimes.has(runtime))
      throw new BridgeError(
        'EVENT_RUNTIME_EXPIRED',
        'Rediscover the runtime and read its current state',
      );
    let sequence = 0;
    if (cursor) {
      let parsed;
      try {
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      } catch {
        throw new BridgeError('INVALID_CURSOR');
      }
      if (
        !Array.isArray(parsed) ||
        parsed[0] !== runtime ||
        !Number.isSafeInteger(parsed[1]) ||
        parsed[1] < 0
      )
        throw new BridgeError('CURSOR_RUNTIME_MISMATCH');
      sequence = parsed[1];
    }
    const rows = this.rows.filter((e) => e.runtime_id === runtime && e.sequence > sequence);
    const events = rows.slice(0, limit);
    const lastDropped = this.dropped.get(runtime) ?? 0;
    return {
      events,
      next_cursor: Buffer.from(
        JSON.stringify([runtime, events.at(-1)?.sequence ?? sequence]),
      ).toString('base64url'),
      has_more: rows.length > limit,
      gap: sequence < lastDropped,
    };
  }
  responseState(id: string, status: NativeEvent['response_status']) {
    const event = this.event(id);
    if (!event) throw new BridgeError('EVENT_EXPIRED');
    if (event.response_status !== 'resolved') event.response_status = status;
    this.onEvent(event);
    return event;
  }
  resolveServerRequest(runtime: string, id: unknown) {
    for (const event of this.rows)
      if (event.runtime_id === runtime && event.kind === 'server_request' && event.native.id === id)
        this.responseState(event.event_id, 'resolved');
  }
  expireRuntime(runtime: string) {
    this.runtimes.delete(runtime);
    this.dropped.delete(runtime);
    for (const event of this.rows)
      if (
        event.runtime_id === runtime &&
        ['pending', 'responding', 'submitted'].includes(event.response_status ?? '')
      )
        this.responseState(event.event_id, 'expired');
  }
}
