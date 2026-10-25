import { z } from 'zod';
import { interfaceSchema } from '../devices.ts';

export const heartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  protocol: z.number(),
  // Heartbeats carry routing/availability, not local health diagnostics or native errors.
  interfaces: z.array(interfaceSchema.omit({ diagnostic: true })).optional(),
  availability: z.string(),
  desktopVersion: z.string().optional(),
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
