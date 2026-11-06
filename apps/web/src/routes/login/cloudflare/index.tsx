import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { cloudflareStatusQuery } from '../../../queries/login.ts';
import { cloudflareCompleteMutation } from '../../../mutations/login.ts';
import { Login } from '../../../components/auth/login.tsx';
import { Alert } from '../../../components/ui/feedback.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { ApiError } from '../../../api/client.ts';
import { t } from '../../../i18n/index.ts';

export const Route = createFileRoute('/login/cloudflare/')({ component: CloudflareResult });
const deniedCodes = [
  'NOT_A_TARGET_ACCOUNT_MEMBER',
  'TARGET_WORKER_MANAGEMENT_REQUIRED',
  'CF_ACCESS_DENIED',
];
function CloudflareResult() {
  const status = useQuery(cloudflareStatusQuery());
  const complete = useMutation(cloudflareCompleteMutation());
  const started = useRef(false);
  const mutate = complete.mutate;
  const refreshStatus = status.refetch;
  const finish = useCallback(
    () =>
      mutate(undefined, {
        onSuccess: (result) => window.location.replace(result.return_to),
        onError: () => void refreshStatus(),
      }),
    [mutate, refreshStatus],
  );
  const phase = status.data?.phase;
  useEffect(() => {
    if (['callback', 'checking'].includes(phase ?? '') && !started.current) {
      started.current = true;
      finish();
    }
  }, [phase, finish]);
  const failure = status.data?.failure;
  const error = complete.error ?? status.error;
  const code = failure?.code ?? (error instanceof ApiError ? error.code : '');
  const returnTo = status.data?.return_to ?? '/admin';
  if (deniedCodes.includes(code))
    return (
      <Login
        denied={{ email: failure?.email ?? null }}
        returnTo={returnTo}
        onDone={() => window.location.replace(returnTo)}
      />
    );
  const failed = !!error || !!failure || phase === 'waiting' || phase === 'exchanging';
  return (
    <div className="focus-shell">
      <div className="auth-card">
        <img className="auth-mark" src="/branding/dotx.png" alt="" />
        <h1>{failed ? t.login.failedTitle : t.login.authorizedTitle}</h1>
        {!failed && (
          <>
            <p className="lede">{t.login.checkingBody}</p>
            <div className="oauth-spinner">
              <span className="spinner" />
            </div>
          </>
        )}
        {failed && (
          <>
            <Alert
              error={
                error ??
                new ApiError(401, code || 'CF_LOGIN_EXPIRED', t.errors.CF_LOGIN_EXPIRED, '')
              }
              retry={
                phase === 'checking' && error instanceof ApiError && error.status >= 500
                  ? () => finish()
                  : undefined
              }
            />
            <Button variant="solid" block large onClick={() => window.location.replace(returnTo)}>
              {t.login.backToLogin}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
