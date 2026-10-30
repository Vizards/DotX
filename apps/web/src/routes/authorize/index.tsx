import { useState } from 'react';
import { Login } from '../../components/auth/login.tsx';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { sessionQuery } from '../../queries/session.ts';
import { authorizationQuery } from '../../queries/authorization.ts';
import { ConsentForm } from './-components/consent-form.tsx';
import { Alert, Loading } from '../../components/ui/feedback.tsx';
import { ApiError } from '../../api/client.ts';
import { t } from '../../i18n/index.ts';

export const Route = createFileRoute('/authorize/')({
  validateSearch: (search: Record<string, unknown>) => ({
    transaction: typeof search.transaction === 'string' ? search.transaction : '',
  }),
  component: Authorize,
});

function Authorize() {
  const { transaction } = Route.useSearch();
  const query = useQuery(authorizationQuery(transaction));
  const session = useQuery({
    ...sessionQuery(),
    enabled: query.data?.phase === 'waiting' && !query.error,
  });
  const [login, setLogin] = useState(false);
  // Approval or rejection from management also returns to the client while
  // this tab is showing login. Expired requests cannot continue.
  if (login && !session.data?.authenticated && !query.error && query.data?.phase === 'waiting')
    return <Login onDone={() => window.location.reload()} onBack={() => setLogin(false)} />;

  return (
    <div className="focus-shell">
      <div className="step-card">
        {query.isPending && <Loading />}
        {query.error &&
          (query.error instanceof ApiError &&
          ['AUTHORIZATION_EXPIRED', 'AUTHORIZATION_REMOVED'].includes(query.error.code) ? (
            // Nothing here can be repaired from this page: the client has to
            // start over, so the page says that once and stops.
            <>
              <img className="auth-mark" src="/branding/dotx.png" alt="" />
              <h1>{t.authorize.expiredTitle}</h1>
              <p className="lede">{t.authorize.expired}</p>
            </>
          ) : (
            <>
              <h1>{t.authorize.loadFailed}</h1>
              <Alert
                error={query.error}
                retry={() => {
                  void query.refetch();
                }}
              />
            </>
          ))}
        {!query.error && query.data && (
          <ConsentForm
            key={transaction}
            context={query.data}
            session={session}
            onLogin={() => setLogin(true)}
          />
        )}
      </div>
    </div>
  );
}
