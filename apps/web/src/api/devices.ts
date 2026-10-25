import type { AdminDevice, DeviceRequest } from '@dotx/shared/http/admin';
import { api } from './client.ts';
export const devices = (signal?: AbortSignal) =>
  api<{ devices: AdminDevice[] }>('/admin/api/devices', { signal });
export const requests = (signal?: AbortSignal) =>
  api<{ requests: DeviceRequest[] }>('/admin/api/device-requests', { signal });
export const decideRequest = (id: string, decision: 'approve' | 'reject', csrf: string) =>
  api<DeviceRequest>(`/admin/api/device-requests/${encodeURIComponent(id)}/${decision}`, {
    method: 'POST',
    csrf,
  });
export const revokeDevice = (id: string, csrf: string) =>
  api<AdminDevice>(`/admin/api/devices/${encodeURIComponent(id)}/revoke`, { method: 'POST', csrf });
