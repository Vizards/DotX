import type { AdminClaimStatus } from '@dotx/shared/http/admin';
import { Alert } from '../ui/feedback.tsx';
import { Button } from '../ui/button.tsx';
import { Dialog } from '../ui/dialog.tsx';
import { Prompt } from '../prompt.tsx';
import { useNow } from '../../hooks/use-now.ts';
import { fill, since, t } from '../../i18n/index.ts';
import { guideUrl } from '../../lib/guides.ts';

/**
 * The way back in without a working login: Cloudflare proof, or the Agent that
 * installed the Server. It also carries an unfinished claim, so a reset that
 * was interrupted is resumed here instead of taking over the sign-in screen.
 */
export function RecoverDialog({
  open,
  mode,
  claim,
  starting,
  error,
  retry,
  onStart,
  onContinue,
  onClose,
}: {
  open: boolean;
  /** An unconfigured Server claims; a configured one resets. */
  mode: 'claim' | 'reset';
  claim: AdminClaimStatus | null;
  starting: boolean;
  error?: unknown;
  retry?: () => void;
  onStart: () => void;
  onContinue: () => void;
  onClose: () => void;
}) {
  const now = useNow(30_000);
  const copy =
    mode === 'claim'
      ? {
          title: t.login.unconfiguredTitle,
          start: t.login.recoverReset,
          unfinished: t.login.unfinishedSetup,
          action: t.login.continueSetup,
          hint: t.login.unconfiguredAgentBody,
          prompt: t.login.setupPrompt,
        }
      : {
          title: t.login.recoverTitle,
          start: t.login.recoverReset,
          unfinished: t.login.unfinishedReset,
          action: t.login.continueReset,
          hint: t.login.recoverAgentBody,
          prompt: t.login.recoverPrompt,
        };

  const pending = claim?.claim ?? null;

  return (
    <Dialog open={open} title={copy.title} kind="modal" onClose={onClose}>
      <section className="recover-part">
        <h3>{t.login.recoverCloudflare}</h3>
        <Alert error={error} retry={retry} />
        {pending ? (
          <>
            <p>
              {pending.expires_at > now
                ? copy.unfinished.replace('{time}', since(pending.expires_at, now))
                : t.claim.expired}
            </p>
            <Button variant="outline" block large onClick={onContinue}>
              {copy.action}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" block large disabled={starting} onClick={onStart}>
              {copy.start}
            </Button>
          </>
        )}
      </section>
      <div className="or">{t.login.or}</div>
      <section className="recover-part">
        <h3>{t.login.recoverAgent}</h3>
        <p>{copy.hint}</p>
        <Prompt
          value={fill(copy.prompt, {
            origin: window.location.origin,
            guide: guideUrl('server/browser-login.md'),
          })}
        />
      </section>
    </Dialog>
  );
}
