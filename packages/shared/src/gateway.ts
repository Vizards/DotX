import { z } from 'zod';
export const WIRE_VERSION = 2;
const id = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
export const interfaceName = z.enum(['app_tools', 'app_server', 'client_coordination']);
export const address = { connection_id: id, interface: interfaceName };
export const gatewaySchemas = {
  describe_methods: z.strictObject({ ...address, method: z.string().min(1).optional() }),
  call: z.strictObject({
    ...address,
    runtime_id: id,
    request_id: id,
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
    tracking: z.enum(['native', 'thread_turn']).default('native'),
  }),
  get_request: z.strictObject({ request_id: id }),
  read_events: z.strictObject({
    ...address,
    runtime_id: id,
    cursor: z.string().optional(),
    limit: z.number().int().min(1).default(50),
  }),
  respond: z.strictObject({
    event_id: id,
    response: z.union([
      z.strictObject({ result: z.unknown() }),
      z.strictObject({
        error: z.object({
          code: z.number().int(),
          message: z.string(),
          data: z.unknown().optional(),
        }),
      }),
    ]),
  }),
};
export type GatewayOperation = keyof typeof gatewaySchemas;
export type Call = z.infer<typeof gatewaySchemas.call>;
export type NativeResponse =
  | { result: unknown; error?: never }
  | { result?: never; error: { code: number; message: string; data?: unknown } };
export interface InterfaceStatus {
  name: z.infer<typeof interfaceName>;
  runtime_id: string;
  availability: 'online' | 'unavailable';
  version?: string;
  diagnostic?: { code: string } | null;
}
export const interfaceSchema = z.object({
  name: interfaceName,
  runtime_id: id,
  availability: z.enum(['online', 'unavailable']),
  version: z.string().optional(),
  diagnostic: z.object({ code: z.string() }).nullable().optional(),
});
export const gatewayCommand = z.object({
  type: z.literal('command'),
  protocol: z.literal(WIRE_VERSION),
  id: z.string(),
  operation: z.enum([
    'describe_methods',
    'call',
    'read_events',
    'respond',
    'read_turn',
    'read_turn_result',
    'resolve_turn',
  ]),
  args: z.unknown(),
});
export interface NativeEvent {
  event_id: string;
  connection_id: string;
  interface: Call['interface'];
  runtime_id: string;
  sequence: number;
  created_at: number;
  kind: 'notification' | 'server_request' | 'lifecycle';
  native: Record<string, unknown>;
  response_schema?: unknown;
  response_status?: 'pending' | 'responding' | 'submitted' | 'resolved' | 'unknown' | 'expired';
  interaction_key?: string;
  response_result?: unknown;
  response_diagnostic?: { code: string };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        // Content identities must not depend on the process locale.
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
