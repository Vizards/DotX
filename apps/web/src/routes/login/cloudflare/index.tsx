import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { cloudflareCompleteMutation } from '../../../mutations/login.ts';
import { Login } from '../../../components/auth/login.tsx';
import { Alert } from '../../../components/ui/feedback.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { ApiError } from '../../../api/client.ts';
import { t } from '../../../i18n/index.ts';

export const Route = createFileRoute('/login/cloudflare/')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: search.error === 'expired' || search.error === 'failed' ? search.error : undefined,
  }),
  component: CloudflareResult,
});
const deniedCodes = [
  'NOT_A_TARGET_ACCOUNT_MEMBER',
  'TARGET_WORKER_MANAGEMENT_REQUIRED',
  'CF_ACCESS_DENIED',
];
function CloudflareResult() {
  const { error: callbackError } = Route.useSearch();
  const complete = useMutation(cloudflareCompleteMutation());
  const started = useRef(false);
  const finish = complete.mutate;
  useEffect(() => {
    if (!callbackError && !started.current) {
      started.current = true;
      finish(undefined, {
        onSuccess: (result) => window.location.replace(result.return_to),
      });
    }
  }, [callbackError, finish]);
  const failure = complete.error instanceof ApiError ? complete.error : null;
  const details = failure?.details as { return_to?: string; email?: string | null } | undefined;
  const returnTo = details?.return_to ?? '/admin';
  if (failure && deniedCodes.includes(failure.code))
    return (
      <Login
        denied={{ email: details?.email ?? null }}
        returnTo={returnTo}
        onDone={() => window.location.replace(returnTo)}
      />
    );
  const error = callbackError
    ? t.errors[callbackError === 'expired' ? 'CF_LOGIN_EXPIRED' : 'CF_LOGIN_FAILED']
    : complete.error;
  return (
    <div className="focus-shell">
      <div className="auth-card">
        <img className="auth-mark" src="/branding/dotx.png" alt="" />
        <h1>{error ? t.login.failedTitle : t.login.authorizedTitle}</h1>
        {!error ? (
          <>
            <p className="lede">{t.login.checkingBody}</p>
            <div className="oauth-spinner">
              <span className="spinner" />
            </div>
          </>
        ) : (
          <>
            <Alert error={error} />
            <Button variant="solid" block large onClick={() => window.location.replace(returnTo)}>
              {t.login.backToLogin}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
