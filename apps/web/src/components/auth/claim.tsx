import { useState, type ReactNode } from 'react';
import type { AdminClaimStatus } from '@dotx/shared/http/admin';
import { PasswordForm, PasskeyForm } from './login-methods.tsx';
import { Alert } from '../ui/feedback.tsx';
import { Button } from '../ui/button.tsx';
import { Dialog } from '../ui/dialog.tsx';
import { Tabs } from '../ui/tabs.tsx';
import { useConfirm } from '../confirm-context.ts';
import { since, t } from '../../i18n/index.ts';
import { useCopy } from '../../hooks/use-copy.ts';
import { useNow } from '../../hooks/use-now.ts';

type Step = 1 | 2 | 3;
type State = 'done' | 'active' | 'pending';

/**
 * Verification happens in a dialog: there is no address to return to, and the
 * login screen behind it is where the user came from.
 */
export function Claim({
  status,
  checking,
  checkError,
  check,
  restart,
  onClose,
  onComplete,
}: {
  status: AdminClaimStatus;
  checking: boolean;
  checkError?: unknown;
  check: () => void;
  restart: () => Promise<unknown>;
  onClose: () => void;
  onComplete: () => void;
}) {
  const claim = status.claim!;
  const copy = useCopy();
  const confirm = useConfirm();
  const [sent, setSent] = useState(false);
  const [checked, setChecked] = useState(() => Date.now());
  const now = useNow();
  // A click on a card wins over the inferred state, in both directions: it can
  // fold the current step or open any other one. The click is tagged with the
  // step it was made at, so it stops applying once the flow moves past it.
  const [override, setOverride] = useState<{ at: Step; step: Step; open: boolean } | null>(null);
  // Two ways to set a login, never both on screen: the extra form pushed the
  // dialog past the viewport for no added choice.
  const [method, setMethod] = useState<'passkey' | 'password'>('passkey');

  // The step is inferred from state, not clicks alone: a verified deployment
  // lands on step 3 even when this page is opened in another tab. 原则 4
  const step: Step = claim.verified ? 3 : sent ? 2 : 1;
  const stateOf = (index: Step): State =>
    index < step ? 'done' : index === step ? 'active' : 'pending';
  const openOf = (index: Step) =>
    override?.at === step && override.step === index ? override.open : stateOf(index) === 'active';
  const toggle = (index: Step) => setOverride({ at: step, step: index, open: !openOf(index) });

  const expired = claim.expires_at <= now;

  const content = status.secret_present
    ? claim.challenge
    : `${status.secret_name}=${claim.challenge}`;

  const copyAndOpen = async () => {
    const ok = await copy.copy(content);
    if (ok) setSent(true);
    window.open(status.settings_url, '_blank', 'noopener,noreferrer');
  };

  const recheck = () => {
    setChecked(Date.now());
    check();
  };

  const startOver = async () => {
    const ok = await confirm({
      title: t.claim.restartTitle,
      body: t.claim.restartBody,
      confirm: t.claim.restart,
      danger: true,
      onConfirm: restart,
    });
    if (!ok) return;
    setSent(false);
    setOverride(null);
  };

  return (
    <Dialog
      open
      title={claim.reset ? t.claim.resetTitle : t.claim.setupTitle}
      kind="modal"
      wide
      onClose={onClose}
    >
      <p className="lede claim-lede">{claim.reset ? t.claim.resetLede : t.claim.setupLede}</p>
      <Alert error={checkError} />

      <ol className="claim-steps">
        <StepCard
          index={1}
          state={stateOf(1)}
          title={t.claim.step1Title}
          hint={t.claim.step1Hint}
          summary={status.secret_present ? t.claim.step1DoneWritten : t.claim.step1DoneCopied}
          open={openOf(1)}
          onToggle={() => toggle(1)}
          aside={
            <span className="claim-expiry">
              {expired
                ? t.claim.expired
                : t.claim.expires.replace('{time}', since(claim.expires_at, now))}
              <button type="button" className="linkbtn" onClick={() => void startOver()}>
                {t.claim.restart}
              </button>
            </span>
          }
        >
          <p>
            {(status.secret_present ? t.claim.step1BodyPresent : t.claim.step1BodyNew).replace(
              '{name}',
              status.secret_name,
            )}
          </p>
          {/* One control, one action: the solid button copies this value. */}
          <div className="copyline">
            <code>{content}</code>
          </div>
          <Alert error={copy.error} />
          <div className="step-acts">
            <Button variant="solid" onClick={() => void copyAndOpen()}>
              {sent ? t.claim.step1Reopen : t.claim.step1Copy}
            </Button>
            <span className="step-aside">{t.claim.step1BodyTail}</span>
          </div>
          <details>
            <summary>{t.claim.details}</summary>
            <p>
              {t.claim.detailsBody
                .replace('{pair}', `${status.secret_name}=${claim.challenge}`)
                .replace('{value}', claim.challenge)}
            </p>
          </details>
        </StepCard>

        <StepCard
          index={2}
          state={stateOf(2)}
          title={t.claim.step2Title}
          hint={t.claim.step2Hint}
          summary={t.claim.step2Detected}
          open={openOf(2)}
          onToggle={() => toggle(2)}
        >
          <div className="step-acts">
            <Button variant="outline" disabled={checking} onClick={recheck}>
              {checking ? t.claim.step2Checking : t.claim.step2Check}
            </Button>
          </div>
          {!checkError && (
            <div className="detect" role="status">
              <span className="dotpulse" aria-hidden="true" />
              <span>
                {claim.verified
                  ? t.claim.step2Detected
                  : t.claim.step2LastCheck.replace('{time}', since(checked, now))}
              </span>
            </div>
          )}
          {!checkError && !claim.verified && (
            <p className="hint">
              {status.value_format_issue === 'name_in_value'
                ? t.claim.nameInValue.replace('{name}', status.secret_name)
                : status.secret_present
                  ? t.claim.mismatch
                  : t.claim.missing.replace('{name}', status.secret_name)}
            </p>
          )}
        </StepCard>

        <StepCard
          index={3}
          state={stateOf(3)}
          title={t.claim.step3Title}
          hint={t.claim.step3Hint}
          summary={t.claim.step3Done}
          open={openOf(3)}
          onToggle={() => toggle(3)}
        >
          <p>{t.claim.step3Body}</p>
          {claim.reset && <p className="hint">{t.claim.resetWarn}</p>}
          <Tabs
            value={method}
            onChange={setMethod}
            items={[
              { value: 'passkey', label: t.security.passkeyTitle },
              { value: 'password', label: t.security.passwordTitle },
            ]}
          />
          {method === 'passkey' ? (
            <PasskeyForm
              auth={{ claim: true }}
              name
              label={t.security.passkeyCreate}
              onSubmit={onComplete}
            />
          ) : (
            <PasswordForm
              auth={{ claim: true }}
              submitLabel={t.forms.savePassword}
              onSubmit={onComplete}
            />
          )}
        </StepCard>
      </ol>
    </Dialog>
  );
}

/**
 * One numbered card. All three are always present, so the flow's length and
 * the remaining work are visible from the first screen; the header is the
 * control that folds or opens it. 原则 4
 */
function StepCard({
  index,
  state,
  title,
  hint,
  summary,
  open,
  onToggle,
  aside,
  children,
}: {
  index: Step;
  state: State;
  title: string;
  hint: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  /** A header action that must stay outside the toggle button. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const done = state === 'done';

  return (
    <li
      className="claim-step"
      data-state={state}
      aria-current={state === 'active' ? 'step' : undefined}
    >
      <div className="claim-step-head">
        <button type="button" className="claim-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="claim-num" aria-hidden="true">
            {done ? '✓' : index}
          </span>
          <span className="claim-text">
            <span className="claim-title">{title}</span>
            {!open && <span className="claim-hint">{done ? summary : hint}</span>}
          </span>
        </button>
        {aside}
        <button
          type="button"
          className="claim-expand"
          aria-expanded={open}
          aria-label={open ? t.claim.collapse : t.claim.expand}
          onClick={onToggle}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M4 6l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {open && <div className="claim-step-body">{children}</div>}
    </li>
  );
}
