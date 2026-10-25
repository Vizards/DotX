import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { sessionQuery } from '../../queries/session.ts';
import { Navigation } from './-navigation.tsx';
import { Feedback, Loading } from '../../components/feedback.tsx';
export const Route = createFileRoute('/admin')({
  component: Admin,
  validateSearch: (search: Record<string, unknown>): { login_error?: string } => ({
    login_error: typeof search.login_error === 'string' ? search.login_error : undefined,
  }),
});
function Admin() {
  const session = useQuery(sessionQuery());
  const location = useLocation();
  const { login_error } = Route.useSearch();
  if (session.isPending) return <Loading />;
  if (session.error)
    return (
      <>
        {session.data?.authenticated && <Navigation csrf={session.data.csrf_token!} />}
        <Feedback
          error={session.error}
          retry={() => {
            void session.refetch();
          }}
        />
      </>
    );
  if (!session.data.authenticated)
    return (
      <>
        <h1>Manage DotX</h1>
        {login_error && (
          <p role="alert">
            Cloudflare login did not complete ({login_error}). Try signing in again.
          </p>
        )}
        <p>
          {session.data.reason === 'forbidden'
            ? 'This Cloudflare identity cannot manage this Worker. Sign in with an authorized account.'
            : 'Sign in with Cloudflare to manage this Worker.'}
        </p>
        <a
          className="button"
          href={`/admin/login?return_to=${encodeURIComponent(location.pathname)}`}
        >
          Sign in with Cloudflare
        </a>
      </>
    );
  return (
    <>
      <Navigation csrf={session.data.csrf_token!} />
      <Outlet />
    </>
  );
}
