import { z } from 'zod';
import { WIRE_VERSION } from './version.ts';
import { interfaceName } from '../devices.ts';
import { id } from '../requests.ts';

// Arguments carried from Server to Desktop. MCP presentation and server-only
// operations remain in Server; Desktop must not import the Server package.
const address = { connection_id: id, interface: interfaceName };
export const deviceRequestSchemas = {
  describe_methods: z.strictObject({ ...address, method: z.string().min(1).optional() }),
  call: z.strictObject({
    ...address,
    runtime_id: id,
    request_id: id.optional(),
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).nullable().optional(),
    tracking: z.enum(['native', 'thread_turn']).default('native'),
  }),
  read_events: z.strictObject({
    ...address,
    runtime_id: id,
    cursor: z.string().optional(),
    limit: z.number().int().min(1).default(50),
  }),
};
export type Call = z.infer<typeof deviceRequestSchemas.call>;
export type NativeResponse =
  | { result: unknown; error?: never }
  | { result?: never; error: unknown };
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
    'inspect_turn',
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
  response_diagnostic?: unknown;
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
