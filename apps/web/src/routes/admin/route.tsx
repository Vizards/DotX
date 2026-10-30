import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { sessionQuery } from '../../queries/session.ts';
import { Login } from '../../components/auth/login.tsx';
import { AdminShell } from '../../components/layout.tsx';
import { Alert, Loading } from '../../components/ui/feedback.tsx';

export const Route = createFileRoute('/admin')({ component: Admin });

function Admin() {
  const session = useQuery(sessionQuery());

  if (session.isPending) return <Loading />;
  if (session.error)
    return (
      <div className="focus-shell">
        <div className="narrow">
          <Alert
            error={session.error}
            retry={() => {
              void session.refetch();
            }}
          />
        </div>
      </div>
    );

  if (!session.data.authenticated) return <Login onDone={() => window.location.reload()} />;

  return (
    <AdminShell
      version={session.data.service.version}
      wire={session.data.service.wire_protocol}
      csrf={session.data.csrf_token!}
    >
      <Outlet />
    </AdminShell>
  );
}
