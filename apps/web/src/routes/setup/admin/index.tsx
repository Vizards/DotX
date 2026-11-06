import { useState } from 'react';
import { createFileRoute, Link, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { setupQuery } from '../../../queries/setup.ts';
import { PasswordForm, PasskeyForm } from '../../../components/auth/login-methods.tsx';
import { Alert, Loading } from '../../../components/ui/feedback.tsx';
import { Tabs } from '../../../components/ui/tabs.tsx';
import { ApiError } from '../../../api/client.ts';
import { t } from '../../../i18n/index.ts';

export const Route = createFileRoute('/setup/admin/')({ component: Setup });

function Setup() {
  const secret = useLocation({ select: (location) => location.hash });
  const status = useQuery(setupQuery(secret));
  const [method, setMethod] = useState<'passkey' | 'password'>('passkey');

  if (status.isPending)
    return (
      <div className="focus-shell">
        <Loading />
      </div>
    );

  const expired = status.error instanceof ApiError && status.error.code === 'SETUP_LINK_EXPIRED';
  if (status.error)
    return (
      <div className="focus-shell">
        <div className="auth-card">
          <img className="auth-mark" src="/branding/dotx.png" alt="" />
          <h1>{expired ? t.setup.expiredTitle : t.setup.title}</h1>
          {expired ? (
            <>
              <p className="lede">{t.setup.expired}</p>
              <Link className="btn btn--solid btn--block btn--lg" to="/admin">
                {t.setup.expiredAction}
              </Link>
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
