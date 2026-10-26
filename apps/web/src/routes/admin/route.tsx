import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { sessionQuery } from '../../queries/session.ts';
import { Navigation } from './-navigation.tsx';
import { Login } from './-login.tsx';
import { Feedback, Loading } from '../../components/feedback.tsx';
export const Route = createFileRoute('/admin')({ component: Admin });
function Admin() {
  const session = useQuery(sessionQuery());
  if (session.isPending) return <Loading />;
  if (session.error)
    return (
      <Feedback
        error={session.error}
        retry={() => {
          void session.refetch();
        }}
      />
    );
  if (!session.data.authenticated) return <Login />;
  return (
    <>
      <Navigation csrf={session.data.csrf_token!} />
      <Outlet />
    </>
  );
}
