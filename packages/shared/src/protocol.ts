export const MCP_PROTOCOL_VERSION = '2026-07-28';
import { interfaceSchema } from './gateway.ts';
import type { InterfaceStatus } from './gateway.ts';
import { z } from 'zod';

export const id = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
export const nativeHost = z
  .string()
  .refine((v) => v === 'local' || /^remote-control:.+/.test(v), 'Unsupported native Mac host');
export type Diagnostic = unknown;
export type Availability = 'online' | 'offline' | 'unavailable';
export interface Heartbeat {
  interfaces?: Omit<InterfaceStatus, 'diagnostic'>[];
  availability: Availability;
  desktopVersion?: string;
  connectorVersion?: string;
  instanceId?: string;
}
export interface RegisteredDevice {
  id: string;
  label: string;
  tokenHash: string;
}
export interface DeviceInfo {
  interfaces?: Heartbeat['interfaces'];
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
// changes to consumed identity/status fields require rechecking health and send preflight.
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
export const readSchema = z
  .object({
    schemaVersion: z.literal(1),
    thread: threadSchema,
  })
  .passthrough();
export type NativeRead = z.infer<typeof readSchema>;
export interface NativeItem {
  type: string;
  [key: string]: unknown;
}
export type ThreadStatus = z.infer<typeof threadStatusSchema>;
export const heartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  protocol: z.number(),
  // Heartbeats carry routing/availability, not local health diagnostics or native errors.
  interfaces: z.array(interfaceSchema.omit({ diagnostic: true })).optional(),
  availability: z.string(),
  desktopVersion: z.string().optional(),
  connectorVersion: z.string().optional(),
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
    error: z.unknown(),
  }),
]);
