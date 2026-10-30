import type { Heartbeat, Diagnostic } from '@dotx/shared/devices';
import type { WIRE_VERSION } from '@dotx/shared/wire/version';
export interface InstanceStatus extends Heartbeat {
  diagnostic?: Diagnostic | null;
  protocol: typeof WIRE_VERSION;
  version: string;
  deviceId: string;
  label: string;
  pid: number;
  startedAt: number;
  desktopVersion: string;
  relayDiagnostic?: Diagnostic | null;
}
