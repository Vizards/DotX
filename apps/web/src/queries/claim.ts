import { queryOptions } from '@tanstack/react-query';
import { checkClaim } from '../api/claim.ts';
// Verification is idempotent: recheck on entry/focus, without background polling.
export const claimQuery = () =>
  queryOptions({ queryKey: ['admin-claim'], queryFn: ({ signal }) => checkClaim(signal) });
