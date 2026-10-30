import type { AdminClaimStatus } from '@dotx/shared/http/admin';
import { api } from './client.ts';
export const checkClaim = (signal?: AbortSignal) =>
  api<AdminClaimStatus>('/admin/api/claim/verify', { method: 'POST', body: {}, signal });
export const startClaim = (restart = false) =>
  api<AdminClaimStatus>('/admin/api/claim/start', { method: 'POST', body: { restart } });
