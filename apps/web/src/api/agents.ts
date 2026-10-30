import type { AgentConnection } from '@dotx/shared/http/admin';
import { api } from './client.ts';
export const agents = (signal?: AbortSignal) =>
  api<{ agents: AgentConnection[] }>('/admin/api/agents', { signal });
export const renameAgent = (id: string, name: string, csrf: string) =>
  api<AgentConnection>(`/admin/api/agents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { name },
    csrf,
  });
export const revokeAgent = (id: string, csrf: string) =>
  api<AgentConnection>(`/admin/api/agents/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    csrf,
  });
