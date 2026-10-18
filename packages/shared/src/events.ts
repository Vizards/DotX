import { z } from 'zod';
import { interfaceName } from './gateway.ts';
const id = z.string().min(1);
export const eventName = z.enum(['gateway.request.updated', 'gateway.native.event']);
const base = { connection_id: id };
export const requestFilter = z.strictObject({
  ...base,
  request_id: id.optional(),
  statuses: z.array(z.string().min(1)).min(1).optional(),
});
export const nativeFilter = z.strictObject({
  ...base,
  interface: interfaceName.optional(),
  host_id: id.optional(),
  thread_id: id.optional(),
  turn_id: id.optional(),
  methods: z.array(z.string().min(1)).min(1).optional(),
  kinds: z
    .array(z.enum(['notification', 'server_request', 'lifecycle']))
    .min(1)
    .optional(),
});
export const noticeData = z.strictObject({
  ...base,
  interface: interfaceName,
  runtime_id: id,
  request_id: id.optional(),
  tracking: z.enum(['native', 'thread_turn']).optional(),
  rpc_status: z.string().optional(),
  status: z.string().optional(),
  host_id: id.optional(),
  thread_id: id.optional(),
  turn_id: id.optional(),
  source_event_id: id.optional(),
  read_cursor: z.string().optional(),
  kind: z.enum(['notification', 'server_request', 'lifecycle']).optional(),
  method: z.string().optional(),
  interaction_key: id.optional(),
});
export type NoticeData = z.infer<typeof noticeData>;
export const notice = z.strictObject({
  eventId: id,
  name: eventName,
  timestamp: z.iso.datetime({ offset: true }),
  data: noticeData,
});
export type Notice = z.infer<typeof notice>;
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
      'Tracked-turn state changed. statuses matches the tracked operation state. Read get_request for the result. Ordinary RPC replies are returned directly by call and do not emit this event.',
    delivery: ['webhook'],
    inputSchema: z.toJSONSchema(requestFilter),
    payloadSchema: z.toJSONSchema(noticeData),
  },
  {
    name: 'gateway.native.event',
    description:
      'Native events; desktop tasks must first be followed through client_coordination. Defaults to questions, lifecycle and turn/interaction state changes; methods/kinds select other non-delta events. Subscriptions survive runtime changes. Read the event at read_cursor for its payload; only server_request events accept respond.',
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
      'request_user_input_async',
      'thread-stream-state-changed',
      'interaction/updated',
      'turn/completed',
      'turn/failed',
      'thread/status/changed',
    ].includes(d.method ?? '')
  );
}
