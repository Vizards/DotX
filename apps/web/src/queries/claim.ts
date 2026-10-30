import { queryOptions } from '@tanstack/react-query';
import { checkClaim } from '../api/claim.ts';
import { WAITING_POLL_INTERVAL_MS } from './polling.ts';

// Verification is idempotent, so an open claim can be rechecked on a timer and
// on focus. That is what lets step 2 say the deployment is detected on its own.
export const claimQuery = (watch = false) =>
  queryOptions({
    queryKey: ['admin-claim'],
    queryFn: ({ signal }) => checkClaim(signal),
    refetchInterval: (query) =>
      watch &&
      !query.state.error &&
      query.state.data?.claim &&
      !query.state.data.claim.verified &&
      query.state.data.claim.expires_at > Date.now()
        ? WAITING_POLL_INTERVAL_MS
        : false,
  });
