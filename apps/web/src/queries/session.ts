import { queryOptions } from '@tanstack/react-query';
import { session } from '../api/session.ts';
/** Focus and successful authentication refresh the session; no login keepalive. */
export const sessionQuery = () =>
  queryOptions({
    queryKey: ['admin', 'session'],
    queryFn: ({ signal }) => session(signal),
  });
