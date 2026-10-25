import { z } from 'zod';
import type { Diagnostic } from './devices.ts';
import type { Call, gatewayCommand } from './wire/commands.ts';

export const id = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
export const nativeHost = z
  .string()
  .refine((v) => v === 'local' || /^remote-control:.+/.test(v), 'Unsupported native Mac host');
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

export const trackedTarget = z.object({
  hostId: nativeHost.optional(),
  threadId: id,
});

// Cross-boundary execution identity; querying it never authorizes redispatch.
export interface TrackedTask {
  id: string;
  request_id: string;
  connection_id: string;
  hostId: string;
  threadId: string;
  turnId: string | null;
  state: RequestState;
  error?: unknown;
}
export interface TurnObservation {
  task_id: string;
  state: RequestState;
  error?: unknown;
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
