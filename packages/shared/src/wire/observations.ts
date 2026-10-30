import { z } from 'zod';
import { WIRE_VERSION } from './version.ts';
import { notice } from './notices.ts';
import type { Call, NativeEvent } from './commands.ts';

export const observation = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('turn'),
    task_id: z.string(),
    state: z.enum([
      'reserved',
      'accepted',
      'running',
      'waiting_approval',
      'completed',
      'failed',
      'interrupted',
      'rejected',
      'unknown',
    ]),
    turnId: z.string().nullable(),
    error: z.unknown().optional(),
    diagnostic: z.unknown().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('notice'),
    notice,
  }),
]);
export type Observation = z.infer<typeof observation>;
export const observationBatch = z.object({
  type: z.literal('observations'),
  protocol: z.literal(WIRE_VERSION),
  observations: z.array(observation).max(50),
});
export interface ResponseRoute {
  connection_id: string;
  interface: Call['interface'];
  runtime_id: string;
  event_id: string;
  key: string;
}
export const interactionKey = (e: NativeEvent) =>
  JSON.stringify([e.connection_id, e.interface, e.interaction_key ?? [e.runtime_id, e.native.id]]);
