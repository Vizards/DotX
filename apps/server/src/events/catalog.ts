import { z } from 'zod';
import { interfaceName } from '@dotx/shared/devices';
import { eventName, noticeData } from '@dotx/shared/wire/notices';
import type { Notice } from '@dotx/shared/wire/notices';
const id = z.string().min(1);
const base = { connection_id: id };
const requestFilter = z.strictObject({
  ...base,
  request_id: id,
  statuses: z.array(z.string().min(1)).min(1).optional(),
});
const nativeFilterFields = {
  ...base,
  interface: interfaceName.optional(),
  methods: z.array(z.string().min(1)).min(1).optional(),
  kinds: z
    .array(z.enum(['notification', 'server_request', 'lifecycle']))
    .min(1)
    .optional(),
};
const nativeFilter = z.xor([
  z
    .strictObject({ ...nativeFilterFields, request_id: id })
    .describe('Tracked send: provide request_id; omit host_id, thread_id and turn_id.'),
  z
    .strictObject({ ...nativeFilterFields, thread_id: id, turn_id: id, host_id: id.optional() })
    .describe(
      'Existing desktop turn: provide thread_id and turn_id, optionally host_id (local by default); omit request_id.',
    ),
]);
const delivery = z.strictObject({ mode: z.literal('webhook'), url: z.url() });
export const subscribeSchema = z.object({
  name: eventName,
  arguments: z.record(z.string(), z.unknown()),
  delivery: delivery.extend({ secret: z.string() }),
  cursor: z.string().nullable().optional(),
  ttlMs: z.number().int().positive().nullable().optional(),
});
export const unsubscribeSchema = z.object({
  name: eventName,
  arguments: z.record(z.string(), z.unknown()),
  delivery,
});
export type SubscriptionInput = z.infer<typeof subscribeSchema>;
export const eventCatalog = [
  {
    name: 'gateway.request.updated',
    description:
      'One tracked turn changed. Require request_id; subscribe before its tracked send. The subscription ends automatically after terminal delivery/retries, even when statuses excludes that state. Ended turns cannot be subscribed again. Read get_request for current state/results after missed notifications. No history or replay; ordinary RPCs do not emit this event.',
    delivery: ['webhook'],
    inputSchema: z.toJSONSchema(requestFilter),
    payloadSchema: z.toJSONSchema(noticeData),
  },
  {
    name: 'gateway.native.event',
    description:
      'Native events for one turn. Choose exactly one scope: request_id before a tracked send (omit host_id, thread_id and turn_id), or thread_id and turn_id for an existing desktop turn (omit request_id; optional host_id defaults to local). Follow the target through client_coordination. Ends automatically on that turn ending, regardless of method/kind filters; later turns need a new subscription. Defaults to questions, lifecycle and turn/interaction changes; explicit methods/kinds select other emitted events. Read read_events(read_cursor); only server_request accepts respond. Best effort, no replay. Re-establish native follows explicitly after a gap.',
    delivery: ['webhook'],
    inputSchema: z.toJSONSchema(nativeFilter),
    payloadSchema: z.toJSONSchema(noticeData),
  },
];
export function parseFilter(name: Notice['name'], value: unknown) {
  return (name === 'gateway.request.updated' ? requestFilter : nativeFilter).parse(value);
}
export function matchesEvent(name: Notice['name'], args: Record<string, unknown>, e: Notice) {
  if (name !== e.name || args.connection_id !== e.data.connection_id) return false;
  const d = e.data;
  if (name === 'gateway.request.updated') {
    if (d.tracking !== 'thread_turn' || (args.request_id && args.request_id !== d.request_id))
      return false;
    return !Array.isArray(args.statuses) || args.statuses.includes(d.status);
  }
  for (const k of ['interface', 'host_id', 'thread_id', 'turn_id'] as const)
    if (args[k] !== undefined && args[k] !== d[k]) return false;
  if (Array.isArray(args.methods) && !args.methods.includes(d.method)) return false;
  if (Array.isArray(args.kinds) && !args.kinds.includes(d.kind)) return false;
  return (
    !!args.methods ||
    !!args.kinds ||
    d.kind === 'server_request' ||
    d.kind === 'lifecycle' ||
    [
      'item/plan/requestImplementation',
      'request_user_input_async',
      'thread-stream-state-changed',
      'interaction/updated',
      'turn/completed',
      'turn/failed',
      'thread/status/changed',
    ].includes(d.method ?? '')
  );
}
