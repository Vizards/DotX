import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ConsentContext } from '@dotx/shared/http/consent';
import { authorizationMutation } from '../../../mutations/authorization.ts';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Session } from '../../../api/session.ts';
import { loginMethodsQuery } from '../../../queries/login.ts';
import { Alert, Loading } from '../../../components/ui/feedback.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Tabs } from '../../../components/ui/tabs.tsx';
import { ApprovalForm } from '../../../components/agent-approval.tsx';
import { Prompt } from '../../../components/prompt.tsx';
import { useNow } from '../../../hooks/use-now.ts';
import { ApiError } from '../../../api/client.ts';
import { fill, since, t } from '../../../i18n/index.ts';

export function ConsentForm({
  context,
  onLogin,
  session,
}: {
  context: ConsentContext;
  onLogin: () => void;
  session: UseQueryResult<Session, Error>;
}) {
  const methods = useQuery(loginMethodsQuery());
  const submit = useMutation(authorizationMutation());
  const [selectedMethod, setMethod] = useState<'agent' | 'browser'>();
  const method = selectedMethod ?? (methods.data?.configured ? 'browser' : 'agent');
  const attempted = useRef(false);
  const mutate = submit.mutate;
  const now = useNow();
  const expired = context.expires_at <= now;
  const approved = ['approved', 'signing', 'complete'].includes(context.phase);
  const cancelled = context.phase === 'cancelled';
  const restartRequired = submit.error instanceof ApiError && submit.error.status < 500;
  const finish = (decision: 'finish' | 'deny') =>
    submit.mutate(
      { transaction: context.transaction, decision },
      { onSuccess: (result) => window.location.assign(result.redirect) },
    );
  useEffect(() => {
    if (!expired && (approved || cancelled) && !attempted.current) {
      attempted.current = true;
      mutate(
        { transaction: context.transaction, decision: cancelled ? 'deny' : 'finish' },
        {
          onSuccess: (result) => window.location.assign(result.redirect),
        },
      );
    }
  }, [approved, cancelled, expired, context.transaction, mutate]);

  if (expired)
    return (
      <>
        <h1>{t.authorize.expiredTitle}</h1>
        <p className="lede">{t.authorize.expired}</p>
      </>
    );
  if (approved || cancelled)
    return (
      <>
        <h1>{cancelled ? t.authorize.deniedReturning : t.authorize.approved}</h1>
        {submit.isPending && <Loading />}
        <Alert error={submit.error} />
        {restartRequired && <p className="caption">{t.authorize.startAgain}</p>}
        {submit.isError && !restartRequired && (
          <Button
            block
            disabled={submit.isPending}
            onClick={() => finish(cancelled ? 'deny' : 'finish')}
          >
            {t.authorize.continue}
          </Button>
        )}
      </>
    );
  const actor = session.data?.authenticated ? session.data : null;
  return (
    <>
      <img className="auth-mark" src="/branding/dotx.png" alt="" />
      <h1>{fill(t.authorize.title, { client: context.client_name })}</h1>
      <p className="lede">{t.authorize.sharing}</p>
      {session.isPending || (!actor && methods.isPending) ? (
        <Loading />
      ) : actor ? (
        <ApprovalForm request={context} csrf={actor.csrf_token!} />
      ) : session.data && methods.data ? (
        <>
          <Tabs
            value={method}
            onChange={setMethod}
            items={[
              { value: 'agent', label: t.authorize.agentTab },
              { value: 'browser', label: t.authorize.browserTab },
            ]}
          />
          <div
            className="consent-method"
            role="tabpanel"
            aria-label={method === 'agent' ? t.authorize.agentTab : t.authorize.browserTab}
          >
            {method === 'agent' ? (
              <>
                <p className="lede">{t.authorize.agentHint}</p>
                <Prompt
                  value={fill(t.authorize.requestPrompt, {
                    url: `${window.location.origin}/admin/agents?request=${context.transaction}`,
                  })}
                  label={t.authorize.copyRequest}
                />
              </>
            ) : (
              <>
                <p className="lede">
                  {methods.data.configured ? t.authorize.browserHint : t.authorize.setupHint}
                </p>
                <Button variant="solid" block large onClick={onLogin}>
                  {methods.data.configured ? t.authorize.signIn : t.authorize.setup}
                </Button>
              </>
            )}
          </div>
          <div className="consent-footer">
            <span className="consent-expiry">
              {fill(t.authorize.expires, { time: since(context.expires_at, now) })}
            </span>
            <Button
              variant="ghost"
              small
              busy={submit.isPending}
              disabled={submit.isPending}
              onClick={() => finish('deny')}
            >
              {t.authorize.cancel}
            </Button>
          </div>
        </>
      ) : null}
      <Alert
        error={session.error ?? (!actor ? methods.error : null)}
        retry={() => {
          if (session.error) void session.refetch();
          if (!actor && methods.error) void methods.refetch();
        }}
      />
      <Alert error={submit.error} />
    </>
  );
}
