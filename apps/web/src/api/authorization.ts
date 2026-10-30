import type { ConsentContext, AgentAuthorizationRequest } from '@dotx/shared/http/consent';
import { api } from './client.ts';
export const authorization = (transaction: string, signal?: AbortSignal) =>
  api<ConsentContext>(`/oauth/consent?transaction=${encodeURIComponent(transaction)}`, { signal });
export const submitAuthorization = (input: { transaction: string; decision: 'finish' | 'deny' }) =>
  api<{ redirect: string }>('/authorize', { method: 'POST', body: new URLSearchParams(input) });
export const authorizationRequests = (signal?: AbortSignal) =>
  api<{ requests: AgentAuthorizationRequest[] }>('/admin/api/agent-requests', { signal });
export const authorizationRequest = (id: string, signal?: AbortSignal) =>
  api<AgentAuthorizationRequest>(`/admin/api/agent-requests/${encodeURIComponent(id)}`, { signal });
export const decideAuthorization = (
  input: {
    transaction: string;
    decision: 'approve' | 'reject';
    name?: string;
  },
  csrf: string,
) =>
  api<AgentAuthorizationRequest>(
    `/admin/api/agent-requests/${encodeURIComponent(input.transaction)}/${input.decision}`,
    {
      method: 'POST',
      body: input.decision === 'approve' && input.name !== undefined ? { name: input.name } : {},
      csrf,
    },
  );
