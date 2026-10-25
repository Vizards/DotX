import { z } from 'zod';

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
