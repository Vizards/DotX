export const MCP_PROTOCOL_VERSION = '2026-07-28';
import { interfaceSchema } from './gateway.ts';
import type { InterfaceStatus } from './gateway.ts';
import { z } from 'zod';

export const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
export const nativeHost = z
  .string()
  .refine((v) => v === 'local' || /^remote-control:.+/.test(v), 'Unsupported native Mac host');
export interface Diagnostic {
  code: string;
  message?: string;
}
export type Availability = 'online' | 'offline' | 'unavailable';
export interface Heartbeat {
  interfaces?: InterfaceStatus[];
  availability: Availability;
  desktopVersion?: string;
  connectorVersion?: string;
  instanceId?: string;
  diagnostic?: Diagnostic | null;
}
export interface RegisteredDevice {
  id: string;
  label: string;
  tokenHash: string;
}
export interface DeviceInfo {
  interfaces?: InterfaceStatus[];
  deviceId: string;
  label: string;
  availability: Availability;
  targetHostId: 'local';
  connectorDeviceId: string;
  desktopVersion: string | null;
  connectorVersion: string | null;
  lastSeen: number | null;
  diagnostic: Diagnostic | null;
}
export interface DeviceList {
  devices: DeviceInfo[];
  freshnessMs: number;
}
export type Outcome<T = unknown> = { ok: true; result: T } | { ok: false; error: Diagnostic };
export type RequestState =
  | 'reserved'
  | 'accepted'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'rejected'
  | 'unknown';

// Private App Tools read_thread response, not the public App Server thread/read schema.
// schemaVersion below is a payload revision, not a desktop release gate. Preserve extra fields;
// changes to consumed identity/turn fields require rechecking health and exact-turn tracking.
export const threadStatusSchema = z
  .object({ type: z.string(), activeFlags: z.array(z.string()).optional() })
  .passthrough();
export const threadSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    hostId: z.string(),
    title: z.string().nullable().optional(),
    status: threadStatusSchema.optional(),
  })
  .passthrough();
export const itemSchema = z
  .object({
    type: z.string(),
    namespace: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    output: z.unknown().optional(),
  })
  .passthrough();
export const turnSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    items: z.array(itemSchema).optional(),
    error: z.unknown().optional(),
  })
  .passthrough();
export const readSchema = z
  .object({
    schemaVersion: z.literal(1),
    thread: threadSchema,
    turns: z.array(turnSchema),
    page: z.object({ nextCursor: z.string().nullable().optional() }).passthrough().optional(),
  })
  .passthrough();
export type NativeRead = z.infer<typeof readSchema>;
export type NativeTurn = z.infer<typeof turnSchema>;
export type NativeItem = z.infer<typeof itemSchema>;
export type ThreadStatus = z.infer<typeof threadStatusSchema>;
export const heartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  protocol: z.number(),
  interfaces: z.array(interfaceSchema).optional(),
  availability: z.string(),
  desktopVersion: z.string().optional(),
  connectorVersion: z.string().optional(),
  diagnostic: z.object({ code: z.string() }).nullable().optional(),
});
export const responseSchema = z.discriminatedUnion('ok', [
  z.object({
    type: z.literal('response'),
    id: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    type: z.literal('response'),
    id: z.string(),
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string().optional() }),
  }),
]);
