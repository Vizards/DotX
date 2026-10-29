import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { loginMethodsQuery } from '../../queries/login.ts';
import { Alert } from '../ui/feedback.tsx';
import { Prompt } from '../prompt.tsx';
import { RecoverDialog } from './recover.tsx';
import { PasswordForm, PasskeyForm } from './login-methods.tsx';
import { useClaimFlow } from '../../hooks/use-claim-flow.ts';
import { useNow } from '../../hooks/use-now.ts';
import { fill, t } from '../../i18n/index.ts';
import { Claim } from './claim.tsx';

export function Login({ onDone, onBack }: { onDone: () => void; onBack?: () => void }) {
  const methods = useQuery(loginMethodsQuery());
  const now = useNow(30_000);
  const [claimOpen, setClaimOpen] = useState(false);
  const flow = useClaimFlow(claimOpen);
  const [recover, setRecover] = useState(false);

  const start = async () => {
    try {
      await flow.begin();
      setRecover(false);
      setClaimOpen(true);
    } catch {
      // The start mutation displays its error at the entry that was used.
    }
  };

  // A configured Server signs in first. An unfinished reset can still be
  // picked up, but it waits under "遇到问题" rather than replacing the form.
  const status = flow.query.data ?? null;
  const claim = status?.claim ?? null;
  const alive = Boolean(claim && claim.expires_at > now);
  const active = claimOpen && status && alive ? status : null;
  const resume = () => {
    flow.start.reset();
    if (alive) {
      setRecover(false);
      setClaimOpen(true);
    } else void start();
  };

  return (
    <div className="focus-shell">
      <div className="auth-column">
        {(methods.isPending || flow.query.isPending) && (
          <div className="auth-card">
            <span className="spinner" />
          </div>
        )}

        {active && (
          <Claim
            status={active}
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
            onComplete={onDone}
          />
        )}

        {!active && methods.data && !methods.data.configured && (
          <Setup starting={flow.starting} onClaim={resume} error={!recover ? flow.error : null} />
        )}

        {!active && methods.data?.configured && (
          <SignIn
            passkey={methods.data.passkey_enabled}
            password={methods.data.password_enabled}
            unfinished={alive}
            onRecover={() => {
              flow.start.reset();
              setRecover(true);
            }}
            onDone={onDone}
          />
        )}

        {methods.error && (
          <div className="auth-card">
            <Alert
              error={methods.error}
              retry={() => {
                void methods.refetch();
              }}
            />
          </div>
        )}

        {!active && !recover && (
          <Alert error={flow.query.error} retry={() => void flow.query.refetch()} />
        )}
        {onBack && (
          <button type="button" className="linkbtn" onClick={onBack}>
            {t.authorize.back}
          </button>
        )}
      </div>

      <RecoverDialog
        open={recover}
        mode={methods.data?.configured ? 'reset' : 'claim'}
        claim={flow.query.data ?? null}
        starting={flow.starting}
        error={flow.error ?? flow.query.error}
        retry={!flow.error && flow.query.error ? () => void flow.query.refetch() : undefined}
        onStart={() => {
          void start();
        }}
        onContinue={() => {
          resume();
        }}
        onClose={() => {
          flow.start.reset();
          setRecover(false);
        }}
      />
    </div>
  );
}

/** First run: the Agent that installed the Server is the shortest path. */
function Setup({
  starting,
  onClaim,
  error,
}: {
  starting: boolean;
  onClaim: () => void;
  error?: unknown;
}) {
  return (
    <div className="auth-card">
      <img className="auth-mark" src="/branding/dotx.png" alt="" />
      <h1>{t.login.unconfiguredTitle}</h1>
      <p className="lede">{t.login.unconfiguredLede}</p>

      <div className="next-step">
        <h3>{t.login.unconfiguredAgent}</h3>
        <p>{t.login.unconfiguredAgentBody}</p>
        <Prompt value={fill(t.login.setupPrompt, { origin: window.location.origin })} />
      </div>

      <p className="claim-manual">
        <button type="button" className="linkbtn" disabled={starting} onClick={onClaim}>
          {t.login.setupManual}
        </button>
      </p>
      <Alert error={error} />
    </div>
  );
}

/**
 * Both methods stay available, never both on screen. Passkey leads when it
 * exists; the other one is a text switch in the same footer row.
 */
function SignIn({
  passkey,
  password,
  unfinished,
  onRecover,
  onDone,
}: {
  passkey: boolean;
  password: boolean;
  unfinished: boolean;
  onRecover: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'passkey' | 'password'>(passkey ? 'passkey' : 'password');
  const canSwitch = passkey && password;

  return (
    <div
      className={`auth-card auth-card--signin${mode === 'passkey' ? ' auth-card--passkey' : ''}`}
    >
      <img className="auth-mark" src="/branding/dotx.png" alt="" />
      <h1>{t.login.title}</h1>

      {mode === 'passkey' ? (
        <PasskeyForm onSubmit={onDone} label={t.login.passkeyAction} />
      ) : (
        <PasswordForm onSubmit={onDone} submitLabel={t.login.passwordSignIn} autoFocus />
      )}

      <div className="auth-links">
        {canSwitch && (
          <button
            type="button"
            className="linkbtn"
            onClick={() => setMode(mode === 'passkey' ? 'password' : 'passkey')}
          >
            {mode === 'passkey' ? t.login.usePassword : t.login.passkeyAction}
          </button>
        )}
        <button type="button" className="linkbtn" onClick={onRecover}>
          {t.login.reset}
          {unfinished && (
            <>
              {' '}
              <span className="linkbtn-flag" aria-hidden="true" />
              <span className="visually-hidden">{t.login.unfinishedFlag}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
