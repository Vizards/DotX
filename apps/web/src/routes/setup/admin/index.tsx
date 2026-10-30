import { useState } from 'react';
import { createFileRoute, Link, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { setupQuery } from '../../../queries/setup.ts';
import { loginMethodsQuery } from '../../../queries/login.ts';
import { PasswordForm, PasskeyForm } from '../../../components/auth/login-methods.tsx';
import { Alert, Loading } from '../../../components/ui/feedback.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Tabs } from '../../../components/ui/tabs.tsx';
import { RecoverDialog } from '../../../components/auth/recover.tsx';
import { useClaimFlow } from '../../../hooks/use-claim-flow.ts';
import { useNow } from '../../../hooks/use-now.ts';
import { ApiError } from '../../../api/client.ts';
import { t } from '../../../i18n/index.ts';
import { Claim } from '../../../components/auth/claim.tsx';

export const Route = createFileRoute('/setup/admin/')({ component: Setup });

function Setup() {
  const secret = useLocation({ select: (location) => location.hash });
  const status = useQuery(setupQuery(secret));
  const methods = useQuery(loginMethodsQuery());
  const now = useNow(30_000);
  const [method, setMethod] = useState<'passkey' | 'password'>('passkey');
  const [recover, setRecover] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const flow = useClaimFlow(claimOpen);

  if (status.isPending)
    return (
      <div className="focus-shell">
        <Loading />
      </div>
    );

  const expired = status.error instanceof ApiError && status.error.code === 'SETUP_LINK_EXPIRED';
  const claim = flow.query.data?.claim ?? null;
  const alive = Boolean(claim && claim.expires_at > now);
  const active = claimOpen && flow.query.data && alive ? flow.query.data : null;

  const beginClaim = async () => {
    try {
      await flow.begin();
      setRecover(false);
      setClaimOpen(true);
    } catch {
      // RecoverDialog renders the start mutation's error.
    }
  };

  const resume = () => {
    flow.start.reset();
    if (alive) {
      setRecover(false);
      setClaimOpen(true);
    } else void beginClaim();
  };

  if (active)
    return (
      <div className="focus-shell">
        <div className="auth-column">
          <Claim
            status={active}
            onComplete={() => window.location.replace('/admin/security')}
            checking={flow.query.isFetching || flow.starting}
            checkError={flow.query.error}
            check={() => {
              void flow.query.refetch();
            }}
            restart={() => flow.begin(true)}
            onClose={() => {
              flow.start.reset();
              setClaimOpen(false);
            }}
          />
        </div>
      </div>
    );

  if (status.error)
    return (
      <div className="focus-shell">
        <div className="auth-card">
          <img className="auth-mark" src="/branding/dotx.png" alt="" />
          <h1>{expired ? t.setup.expiredTitle : t.setup.title}</h1>
          {expired ? (
            <>
              <p className="lede">{t.setup.expired}</p>
              {/* A configured Server has a way in; an empty one has to claim
                  again, and that path goes through the same recovery dialog
                  as the sign-in screen. */}
              {methods.error ? (
                <Alert error={methods.error} retry={() => void methods.refetch()} />
              ) : methods.data?.configured ? (
                <Link className="btn btn--solid btn--block btn--lg" to="/admin">
                  {t.setup.expiredAction}
                </Link>
              ) : (
                <Button
                  variant="solid"
                  block
                  large
                  disabled={methods.isPending || flow.starting}
                  onClick={() => {
                    flow.start.reset();
                    setRecover(true);
                  }}
                >
                  {t.setup.expiredActionSetup}
                </Button>
              )}
              <p className="caption">{t.setup.expiredHint}</p>
            </>
          ) : (
            <Alert
              error={status.error}
              retry={() => {
                void status.refetch();
              }}
            />
          )}
        </div>

        <RecoverDialog
          open={recover}
          mode="claim"
          claim={flow.query.data ?? null}
          starting={flow.starting}
          error={flow.error ?? flow.query.error}
          retry={!flow.error && flow.query.error ? () => void flow.query.refetch() : undefined}
          onStart={() => void beginClaim()}
          onContinue={resume}
          onClose={() => {
            flow.start.reset();
            setRecover(false);
          }}
        />
      </div>
    );

  const done = () => window.location.replace('/admin/security');

  return (
    <div className="focus-shell">
      <div className="step-card">
        <img className="auth-mark" src="/branding/dotx.png" alt="" />
        <h1>{status.data.reset ? t.setup.resetTitle : t.setup.title}</h1>
        <p className="lede">{t.setup.lede}</p>

        {status.data.reset && (
          <div className="notice" data-tone="attn">
            <p className="meta">{t.setup.resetWarn}</p>
          </div>
        )}

        <Tabs
          value={method}
          onChange={setMethod}
          items={[
            { value: 'passkey', label: t.setup.passkeyTitle },
            { value: 'password', label: t.setup.passwordTitle },
          ]}
        />

        {method === 'passkey' ? (
          <section className="method">
            <p>{t.setup.passkeyBody}</p>
            <PasskeyForm
              auth={{ setup: secret }}
              name
              label={t.security.passkeyCreate}
              onSubmit={done}
            />
          </section>
        ) : (
          <section className="method">
            <PasswordForm
              auth={{ setup: secret }}
              submitLabel={t.forms.savePassword}
              onSubmit={done}
            />
          </section>
        )}
      </div>
    </div>
  );
}
