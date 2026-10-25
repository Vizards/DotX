import { z } from 'zod';
import { id } from './requests.ts';

export const interfaceName = z.enum(['app_tools', 'app_server', 'client_coordination']);
export interface InterfaceStatus {
  name: z.infer<typeof interfaceName>;
  runtime_id: string;
  availability: 'online' | 'unavailable';
  version?: string;
  diagnostic?: unknown;
}
export const interfaceSchema = z.object({
  name: interfaceName,
  runtime_id: id,
  availability: z.enum(['online', 'unavailable']),
  version: z.string().optional(),
  diagnostic: z.unknown().optional(),
});
export type Diagnostic = unknown;
export type Availability = 'online' | 'offline' | 'unavailable';
export interface Heartbeat {
  interfaces?: Omit<InterfaceStatus, 'diagnostic'>[];
  availability: Availability;
  desktopVersion?: string;
}
export interface DeviceInfo {
  interfaces?: Heartbeat['interfaces'];
  deviceId: string;
  label: string;
  availability: Availability;
  desktopVersion: string | null;
  connectorVersion: string | null;
  lastSeen: number | null;
  diagnostic: Diagnostic | null;
}
