import { z } from 'zod';
const sequence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const deviceHello = z.strictObject({
  device_id: z.uuid(),
  key_id: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  generation: sequence,
  attempt: sequence,
  desktop_version: z.string().min(1).max(100),
  wire_protocol: z.number().int().positive(),
});
export type DeviceHello = z.infer<typeof deviceHello>;
export const challengeSchema = deviceHello.extend({
  purpose: z.literal('dotx-device-auth'),
  origin: z.url(),
  service_id: z.uuid(),
  socket_id: z.uuid(),
  server_version: z.string().min(1),
  server_wire_protocol: z.number().int().positive(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expires_at: z.number().int().positive(),
});
export type DeviceChallenge = z.infer<typeof challengeSchema>;
export const proofMessage = z.strictObject({
  type: z.literal('proof'),
  proof: z.string().min(1),
});
export interface ConnectionError {
  type: 'connection_error';
  code: string;
  message: string;
  device_id: string;
  desktop_version: string;
  desktop_wire_protocol: number;
  server_version: string;
  server_wire_protocol: number;
  guide_url: string;
}
export const authResultSchema = z.object({
  type: z.literal('authenticated'),
  status: z.enum(['pending', 'approved']),
  socket_id: z.uuid(),
  server_version: z.string(),
  server_wire_protocol: z.number().int(),
});
export const connectionErrorSchema = z.object({
  type: z.literal('connection_error'),
  code: z.string(),
  message: z.string(),
  device_id: z.string(),
  desktop_version: z.string(),
  desktop_wire_protocol: z.number(),
  server_version: z.string(),
  server_wire_protocol: z.number(),
  guide_url: z.url(),
});
