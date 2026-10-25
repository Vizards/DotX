import type { AgentConnection, AccessCodeResult } from '@dotx/shared/http/admin';
import { api } from './client.ts';
export const agents = (signal?: AbortSignal) =>
  api<{ agents: AgentConnection[] }>('/admin/api/agents', { signal });
export const createAgent = (name: string, csrf: string) =>
  api<AccessCodeResult>('/admin/api/agents', { method: 'POST', body: { name }, csrf });
export const renameAgent = (id: string, name: string, csrf: string) =>
  api<AgentConnection>(`/admin/api/agents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { name },
    csrf,
  });
export const issueCode = (id: string, csrf: string) =>
  api<AccessCodeResult>(`/admin/api/agents/${encodeURIComponent(id)}/enrollment-code`, {
    method: 'POST',
    csrf,
  });
export const cancelCode = (id: string, csrf: string) =>
  api<AgentConnection>(`/admin/api/agents/${encodeURIComponent(id)}/enrollment-code`, {
    method: 'DELETE',
    csrf,
  });
export const revokeAgent = (id: string, csrf: string) =>
  api<AgentConnection>(`/admin/api/agents/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    csrf,
  });
