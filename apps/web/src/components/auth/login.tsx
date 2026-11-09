import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { loginMethodsQuery } from '../../queries/login.ts';
import { cloudflareStartMutation } from '../../mutations/login.ts';
import { Alert, Loading } from '../ui/feedback.tsx';
import { Button } from '../ui/button.tsx';
import { Dialog } from '../ui/dialog.tsx';
import { Prompt } from '../prompt.tsx';
import { RecoverDialog } from './recover.tsx';
import { PasswordForm, PasskeyForm } from './login-methods.tsx';
import { fill, t } from '../../i18n/index.ts';
import { guideUrl } from '../../lib/guides.ts';

export function Login({
  onDone,
  onBack,
  returnTo,
  denied,
}: {
  onDone: () => void;
  onBack?: () => void;
  returnTo?: string;
  denied?: { email: string | null };
}) {
  const methods = useQuery(loginMethodsQuery());
  const start = useMutation(cloudflareStartMutation());
  const [view, setView] = useState<'cloudflare' | 'agent' | 'password'>('cloudflare');
  const [recover, setRecover] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [accountHelp, setAccountHelp] = useState(false);
  const first = !methods.data?.initialized && !denied;
  return (
    <div className="focus-shell">
      <div className="auth-column">
        {methods.isPending && (
          <div className="auth-card">
            <Loading />
          </div>
        )}
        {methods.error && (
          <div className="auth-card">
            <Alert error={methods.error} retry={() => void methods.refetch()} />
          </div>
        )}
        {methods.data &&
          (view === 'agent' ? (
            <Setup onBack={() => setView('cloudflare')} />
          ) : (
            <div
              className={`auth-card${view === 'password' ? ' auth-card--signin' : denied ? '' : ' auth-card--signin auth-card--passkey'}`}
            >
              <img className="auth-mark" src="/branding/dotx.png" alt="" />
              <h1>{view !== 'password' && denied ? t.login.deniedTitle : t.login.title}</h1>
              {view === 'password' ? (
                <>
                  <PasswordForm onSubmit={onDone} submitLabel={t.login.passwordSignIn} autoFocus />
                  <div className="auth-links">
                    <button type="button" className="linkbtn" onClick={() => setView('cloudflare')}>
                      {t.login.otherMethods}
                    </button>
                    <button type="button" className="linkbtn" onClick={() => setRecover(true)}>
                      {t.login.reset}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {denied && (
                    <>
                      {denied.email && (
                        <div className="oauth-account">
                          <small>{t.login.currentAccount}</small>
                          <strong>{denied.email}</strong>
                        </div>
                      )}
                      <p className="lede">{t.login.deniedBody}</p>
                    </>
                  )}
                  <Alert error={start.error} />
                  <Button
                    variant="solid"
                    block
                    large
                    busy={start.isPending}
                    disabled={start.isPending}
                    onClick={() =>
                      start.mutate(returnTo ?? window.location.pathname + window.location.search, {
                        onSuccess: (result) => window.location.assign(result.authorization_url),
                      })
                    }
                  >
                    {denied ? t.login.switchCloudflare : t.login.cloudflareAction}
                  </Button>
                  {(methods.data.passkey_enabled || methods.data.password_enabled) && (
                    <>
                      <div className="login-separator">{t.login.otherMethods}</div>
                      <div className="login-alternatives">
                        {methods.data.passkey_enabled && (
                          <PasskeyForm
                            onSubmit={onDone}
                            label={t.login.passkeyAlternative}
                            variant="outline"
                          />
                        )}
                        {methods.data.password_enabled && (
                          <Button variant="outline" block large onClick={() => setView('password')}>
                            {t.login.usePassword}
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                  {first ? (
                    <ul className="login-help">
                      <li>
                        {t.login.cloudflareAccountHint}
                        <a
                          href="#cloudflare-account"
                          onClick={(event) => {
                            event.preventDefault();
                            setAccountHelp(true);
                          }}
                        >
                          {t.login.askInstallationAgent}
                        </a>
                      </li>
                      <li>
                        {t.login.learnPrivacy}
                        <a
                          href="#privacy"
                          onClick={(event) => {
                            event.preventDefault();
                            setPrivacy(true);
                          }}
                        >
                          {t.login.privacyTitle}
                        </a>
                      </li>
                      <li>
                        {t.login.agentAlternative}
                        <a
                          href="#setup-login"
                          onClick={(event) => {
                            event.preventDefault();
                            setView('agent');
                          }}
                        >
                          {t.login.setupAlternative}
                        </a>
                      </li>
                    </ul>
                  ) : (
                    <div className="auth-links">
                      <button type="button" className="linkbtn" onClick={() => setRecover(true)}>
                        {t.login.reset}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        {onBack && (
          <button type="button" className="linkbtn" onClick={onBack}>
            {t.authorize.back}
          </button>
        )}
      </div>
      <RecoverDialog open={recover} onClose={() => setRecover(false)} />
      <Dialog
        open={accountHelp}
        title={t.login.accountHelpTitle}
        kind="modal"
        onClose={() => setAccountHelp(false)}
      >
        <p className="lede">{t.login.accountHelpBody}</p>
        <Prompt
          value={fill(t.login.accountHelpPrompt, {
            origin: window.location.origin,
            guide: guideUrl('server/browser-login.md'),
          })}
        />
      </Dialog>
      <Dialog
        open={privacy}
        title={t.login.privacyTitle}
        kind="modal"
        onClose={() => setPrivacy(false)}
      >
        <div className="login-privacy">
          <p>{t.login.privacyPermissions}</p>
          <p>{t.login.privacyCredentials}</p>
          <p>{t.login.privacyRelay}</p>
          <p>{t.login.privacyChoice}</p>
        </div>
      </Dialog>
    </div>
  );
}
function Setup({ onBack }: { onBack: () => void }) {
  return (
    <div className="auth-card">
      <img className="auth-mark" src="/branding/dotx.png" alt="" />
      <h1>{t.login.unconfiguredTitle}</h1>
      <p className="lede">{t.login.unconfiguredLede}</p>
      <div className="next-step">
        <h3>{t.login.unconfiguredAgent}</h3>
        <p>{t.login.unconfiguredAgentBody}</p>
        <Prompt
          value={fill(t.login.setupPrompt, {
            origin: window.location.origin,
            guide: guideUrl('server/browser-login.md'),
          })}
        />
      </div>
      <p className="login-switch">
        <button type="button" className="linkbtn" onClick={onBack}>
          {t.login.setupManual}
        </button>
      </p>
    </div>
  );
}
