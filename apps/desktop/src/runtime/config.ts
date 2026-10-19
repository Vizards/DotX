import { WIRE_VERSION } from '@dotx/shared/gateway';
import type { Heartbeat, Diagnostic } from '@dotx/shared/protocol';
// Installation file format; independent of the live connector wire protocol.
export interface DeviceConfig {
  protocol: 1;
  deviceId: string;
  label: string;
  callerThreadId: string;
  callerArchived: boolean;
  codexHome: string;
  desktopVersion: string;
  installedAt: number;
}
export interface ConnectionCredentials {
  relayUrl: string;
  deviceToken: string;
}
export interface InstanceStatus extends Heartbeat {
  diagnostic?: Diagnostic | null;
  protocol: typeof WIRE_VERSION;
  version: string;
  deviceId: string;
  label: string;
  instanceId: string;
  pid: number;
  startedAt: number;
  desktopVersion: string;
  observedAt?: number;
  relayDiagnostic?: Diagnostic | null;
  stdioClosed?: boolean;
}

export function validateConfig(config: DeviceConfig) {
  if (config.protocol !== 1 || !config.deviceId || !config.callerThreadId)
    throw new Error('INVALID_DEVICE_CONFIG: expected protocol 1, deviceId and callerThreadId');
}
