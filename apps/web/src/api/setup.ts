import type { AdminSetupStatus } from '@dotx/shared/http/admin';
import { api } from './client.ts';
export const setupStatus = (setup: string, signal?: AbortSignal) =>
  api<AdminSetupStatus>('/setup/admin/api', { setup, signal });
export const completeSetup = (setup: string, token: string) =>
  api<AdminSetupStatus>('/setup/admin/api', { method: 'POST', setup, body: { token } });
