import type { AdminSession } from '@dotx/shared/http/admin';
import { api, ApiError } from './client.ts';
export type Session = AdminSession | { authenticated: false };
export async function session(signal?: AbortSignal): Promise<Session> {
  try {
    return await api<AdminSession>('/admin/api/session', { signal });
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status))
      return { authenticated: false };
    throw error;
  }
}
export const logout = (csrf: string) =>
  api<{ ok: true }>('/admin/logout', { method: 'POST', csrf });
