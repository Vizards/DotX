import { QueryClient, QueryCache, MutationCache, focusManager } from '@tanstack/react-query';
import { ApiError } from './api/client.ts';
import type { Session } from './api/session.ts';
import { sessionQuery } from './queries/session.ts';

// Visibility covers switching tabs; focus also covers returning from another window.
focusManager.setEventListener((onFocus) => {
  const refresh = () => onFocus();
  window.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  return () => {
    window.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('focus', refresh);
  };
});

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
// A 4xx is the server's answer, not a transient failure: retrying an expired
// link or a rejected credential only keeps the user staring at a spinner.
const retry = (count: number, error: Error) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 3;

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: { queries: { retry } },
});
