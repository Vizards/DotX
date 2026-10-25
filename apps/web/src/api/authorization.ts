import type { ConsentContext } from '@dotx/shared/http/consent';
import { api } from './client.ts';
export const authorization = (transaction: string, signal?: AbortSignal) =>
  api<ConsentContext>(`/oauth/consent?transaction=${encodeURIComponent(transaction)}`, { signal });
export const submitAuthorization = (input: {
  transaction: string;
  decision: 'approve' | 'deny';
  access_code: string;
}) =>
  api<{ redirect: string }>('/authorize', {
    method: 'POST',
    body: new URLSearchParams(input),
  });
