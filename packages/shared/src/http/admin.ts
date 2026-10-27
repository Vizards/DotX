import { z } from 'zod';
import { displayName } from './enrollment.ts';
import type { EnrollmentStatus, DevicePublicKey } from './enrollment.ts';
import type { InterfaceStatus } from '../devices.ts';
import type { ServiceInfo } from './service.ts';
export const nameInput = z.strictObject({ name: displayName });
export interface AdminSetupStatus {
  configured: boolean;
  worker: string;
  password_enabled: boolean;
  passkey_enabled: boolean;
  reset?: boolean;
  expires_at?: number;
}
export interface AdminSecurity {
  password_enabled: boolean;
  passkeys: { id: string; name: string; created_at: number }[];
}
export interface AdminClaim {
  challenge: string;
  reset: boolean;
  verified: boolean;
  expires_at: number;
}
export interface AdminClaimStatus {
  claim: AdminClaim | null;
  secret_name: string;
  secret_present: boolean;
  value_format_issue: 'name_in_value' | null;
  settings_url: string;
  worker: string;
}
export interface AdminSession {
  login_configured: boolean;
  authenticated: true;
  subject: string;
  account_id: string;
  worker: string;
  qualification: string;
  csrf_token: string | null;
  expires_at: number | null;
  service: ServiceInfo;
}
export interface DeviceRequest {
  operation_id: string;
  device_id: string;
  name: string;
  key_id: string;
  public_key: DevicePublicKey;
  status: EnrollmentStatus;
  created_at: number;
  expires_at: number;
}
export interface AdminDevice {
  device_id: string;
  name: string;
  key_id: string;
  public_key: DevicePublicKey;
  status: 'approved' | 'revoked';
  approved_at: number;
  last_seen: number | null;
  online: boolean;
  compatible: boolean | null;
  desktop_version: string | null;
  wire_protocol: number | null;
  server_wire_protocol: number;
  interfaces: InterfaceStatus[];
  diagnostic: unknown | null;
}
export type PendingPhase = 'waiting_code' | 'authorizing' | 'waiting_connection';
export interface AgentConnection {
  agent_id: string;
  name: string;
  created_at: number;
  revoked: boolean;
  active: { grant_id: string; activated_at: number; last_seen: number } | null;
  pending: {
    round_id: string;
    phase: PendingPhase;
    created_at: number;
    code_expires_at: number;
    grant_expires_at: number | null;
  } | null;
}
export interface AccessCodeResult {
  connection: AgentConnection;
  access_code: string;
  expires_at: number;
  mcp_url: string;
}
export interface HttpFailure {
  error: { code: string; message: string; details?: unknown };
}
