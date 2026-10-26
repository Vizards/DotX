import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { ApiError } from './api/client.ts';
import type { Session } from './api/session.ts';
import { sessionQuery } from './queries/session.ts';
function onError(error: Error) {
  if (
    !(error instanceof ApiError) ||
    !error.path.startsWith('/admin/') ||
    error.code === 'CSRF_REQUIRED' ||
    ![401, 403].includes(error.status)
  )
    return;
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] === 'admin' && query.queryKey[1] !== 'session',
  });
  queryClient.setQueryData(sessionQuery().queryKey, (): Session => ({
    authenticated: false,
  }));
}
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
});
