import { BridgeError, safeError } from '@dotx/shared/errors';
import { gatewaySchemas } from '@dotx/shared/gateway';
import type { Call, NativeResponse } from '@dotx/shared/gateway';
import type { DeviceOperation, DispatchArgs, TrackedTask } from '@dotx/shared/state';
import type { Adapter } from '../interfaces/adapter.ts';
import { EventBuffer } from '../events/buffer.ts';
import type { ResolveTurn, TurnIdentity } from '../tracking/attribution.ts';
import { readTurnResult } from '../tracking/result.ts';
import { TurnTracker } from '../tracking/tracker.ts';

// Execution only. Every side effect arrives through the DO's durable reservation.
// No local retry queue, durable receipt, or database proxy.
export class Gateway {
  readonly options: {
    adapters: Map<Call['interface'], Adapter>;
    events: EventBuffer;
    tracker: TurnTracker;
    resolveTurn: ResolveTurn;
    connectionId: string;
  };
  constructor(options: Gateway['options']) {
    this.options = options;
  }
  get adapters() {
    return this.options.adapters;
  }
  statuses() {
    return [...this.adapters.values()].map((a) => a.status());
  }
  async execute(operation: DeviceOperation, input: unknown): Promise<any> {
    const a = input as any;
    if (operation === 'resolve_turn')
      return { turnId: await this.options.resolveTurn(a.task as TurnIdentity) };
    if (operation === 'read_turn_result')
      return readTurnResult(a.task as TrackedTask, (method, params) =>
        this.adapters.get('app_server')!.call(method, params),
      );
    if (operation === 'read_turn') return this.options.tracker.query(a.task as TrackedTask);
    if (operation === 'respond') {
      const event = this.options.events.event(a.event_id);
      if (!event) throw new BridgeError('EVENT_EXPIRED');
      const adapter = this.adapters.get(event.interface);
      if (
        !adapter?.respond ||
        adapter.status().runtime_id !== event.runtime_id ||
        adapter.status().availability !== 'online'
      )
        throw new BridgeError('RUNTIME_CHANGED');
      try {
        await adapter.prepareResponse?.(event, a.response as NativeResponse);
      } catch (error) {
        return { response_status: 'rejected', diagnostic: safeError(error) };
      }
      try {
        const result = await adapter.respond(event, a.response);
        const current = this.options.events.responseState(
          event.event_id,
          result?.status ?? 'submitted',
        );
        return { response_status: current.response_status };
      } catch (error) {
        return { response_status: 'unknown', diagnostic: safeError(error) };
      }
    }
    if (a.connection_id !== this.options.connectionId) throw new BridgeError('WRONG_CONNECTION');
    const adapter = this.adapters.get(a.interface);
    if (!adapter) throw new BridgeError('INTERFACE_NOT_FOUND');
    if (operation === 'describe_methods') {
      const args = gatewaySchemas.describe_methods.parse(input),
        methods = await adapter.methods();
      const selected = args.method
        ? methods.filter((m) => m.name === args.method)
        : methods.map(({ input_schema: _i, output_schema: _o, ...m }) => m);
      if (args.method && !selected.length) throw new BridgeError('NATIVE_METHOD_NOT_FOUND');
      return {
        connection_id: this.options.connectionId,
        interface: args.interface,
        ...adapter.status(),
        methods: selected,
      };
    }
    if (operation === 'read_events') {
      const args = gatewaySchemas.read_events.parse(input);
      const page = this.options.events.events(args.runtime_id, args.cursor, args.limit);
      page.events = page.events.map((e) => adapter.decorateEvent?.(e) ?? e);
      if (page.events.some((e) => e.interface !== args.interface))
        throw new BridgeError('CURSOR_RUNTIME_MISMATCH');
      return {
        ...page,
        runtime_active:
          adapter.status().runtime_id === args.runtime_id &&
          adapter.status().availability === 'online',
      };
    }
    const { task, ...envelope } = a as DispatchArgs;
    const args = gatewaySchemas.call.parse(envelope);
    if (adapter.status().runtime_id !== args.runtime_id) throw new BridgeError('RUNTIME_CHANGED');
    if (adapter.status().availability !== 'online') throw new BridgeError('INTERFACE_UNAVAILABLE');
    const method = (await adapter.methods()).find(
      (m) => m.name === args.method && m.kind === 'request',
    );
    if (!method) throw new BridgeError('NATIVE_METHOD_NOT_FOUND');
    if (method.managed) throw new BridgeError('PROTOCOL_LIFECYCLE_MANAGED');
    if (args.tracking === 'thread_turn') {
      if (!task) throw new BridgeError('TRACKING_CONTEXT_REQUIRED');
      const observation = await this.options.tracker.send(task, args.params);
      return {
        rpc_status:
          observation.state === 'rejected'
            ? 'rejected'
            : observation.state === 'unknown'
              ? 'unknown'
              : 'returned',
        observation,
      };
    }
    try {
      const native = await adapter.call(args.method, args.params);
      return { rpc_status: native.error ? 'error' : 'returned', native };
    } catch (error) {
      return { rpc_status: 'unknown', diagnostic: safeError(error) };
    }
  }
}
