import { WAITING_POLL_INTERVAL_MS } from './polling.ts';
import { queryOptions } from '@tanstack/react-query';
import {
  authorization,
  authorizationRequests,
  authorizationRequest,
} from '../api/authorization.ts';
export const authorizationQuery = (transaction: string) =>
  queryOptions({
    queryKey: ['authorization', transaction],
    queryFn: ({ signal }) => authorization(transaction, signal),
    refetchInterval: (query) =>
      !query.state.error &&
      query.state.data?.phase === 'waiting' &&
      query.state.data.expires_at > Date.now()
        ? WAITING_POLL_INTERVAL_MS
        : false,
  });
export const authorizationRequestsQuery = () =>
  queryOptions({
    queryKey: ['admin', 'agent-requests'],
    queryFn: ({ signal }) => authorizationRequests(signal),
  });
export const authorizationRequestQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'agent-requests', id],
    queryFn: ({ signal }) => authorizationRequest(id, signal),
    refetchInterval: (query) =>
      !query.state.error &&
      query.state.data?.phase === 'waiting' &&
      query.state.data.expires_at > Date.now()
        ? WAITING_POLL_INTERVAL_MS
        : false,
  });
