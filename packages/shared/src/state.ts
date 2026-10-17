import { z } from 'zod';
import { WIRE_VERSION, gatewayCommand } from './gateway.ts';
import type { Call, NativeEvent } from './gateway.ts';
import type { Diagnostic, RequestState } from './protocol.ts';
import { id, nativeHost } from './protocol.ts';
import { notice } from './events.ts';

export const trackedParams = z.strictObject({
  hostId: nativeHost.optional(),
  threadId: id,
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
  thinking: z.string().min(1).optional(),
});

// Only the DO owns these records. Restoring a task authorizes observation, never dispatch.
export interface TrackedTask {
  id: string;
  request_id: string;
  connection_id: string;
  hostId: string;
  threadId: string;
  startedAt: number;
  turnId: string | null;
  state: RequestState;
}
export interface TurnObservation {
  task_id: string;
  state: RequestState;
  turnId: string | null;
  diagnostic?: Diagnostic | null;
}
export const terminal = (state: string) =>
  ['completed', 'failed', 'interrupted', 'rejected'].includes(state);
export interface FollowTarget {
  hostId: string;
  conversationId: string;
}
export type DeviceOperation = z.infer<typeof gatewayCommand>['operation'];
export interface DispatchArgs extends Call {
  task?: TrackedTask;
}
export interface Restore {
  type: 'restore';
  protocol: typeof WIRE_VERSION;
  tasks: TrackedTask[];
  follows: FollowTarget[];
}
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
    diagnostic: z
      .object({ code: z.string(), message: z.string().optional() })
      .nullable()
      .optional(),
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
