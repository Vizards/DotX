import { useState } from 'react';
import type { AdminClaimStatus } from '@dotx/shared/http/admin';
import { PasswordForm, PasskeyForm } from '../../components/login-methods.tsx';

export function Claim({
  status,
  checking,
  check,
  restart,
  back,
}: {
  status: AdminClaimStatus;
  checking: boolean;
  check: () => void;
  restart: () => void;
  back: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const claim = status.claim!;
  const content = status.secret_present
    ? claim.challenge
    : `${status.secret_name}=${claim.challenge}`;
  return (
    <>
      <h1>{claim.reset ? 'Reset browser login' : 'Set up browser login'}</h1>
      <p>
        DotX: <strong>{status.worker}</strong>
      </p>
      {claim.verified ? (
        <>
          <p>Cloudflare verification complete. Choose a password or passkey.</p>
          {claim.reset && (
            <p role="alert">
              Saving replaces the old password and all passkeys, and signs out other browsers.
              Connected Codex and Personal Agents are preserved.
            </p>
          )}
          <PasskeyForm
            auth={{ claim: true }}
            completed={() => window.location.replace('/admin/security')}
          />
          <PasswordForm
            auth={{ claim: true }}
            completed={() => window.location.replace('/admin/security')}
          />
          <p>You can retry if you cancel or a setup attempt fails.</p>
        </>
      ) : (
        <>
          <p>
            Use your Cloudflare account to approve this browser. Write the verification value to
            this Worker's runtime variable, then return here. Variable and Secret both work.
          </p>
          <ol>
            <li>
              {status.secret_present ? (
                <>
                  Copy the value below into the existing <code>{status.secret_name}</code>{' '}
                  variable's <strong>Value</strong> field.
                </>
              ) : (
                <>
                  Copy the line below into Cloudflare's <strong>Key</strong> field. Cloudflare fills
                  both Key and Value from this one paste.
                </>
              )}
              <pre>{content}</pre>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(content).then(
                    () => setCopied(content),
                    () => setCopied(null),
                  );
                }}
              >
                {copied === content
                  ? status.secret_present
                    ? 'Value copied'
                    : 'Name and value copied'
                  : status.secret_present
                    ? 'Copy value'
                    : 'Copy name and value'}
              </button>
              <small> You can also select and copy the text above.</small>
            </li>
            <li>
              <a href={status.settings_url} target="_blank" rel="noreferrer">
                Open Cloudflare settings
              </a>{' '}
              for this Worker.
              {status.secret_present ? (
                <p>
                  In <strong>Runtime variables and secrets</strong>, find{' '}
                  <code>{status.secret_name}</code>
                  and select its pencil/Edit button. Replace <strong>Value</strong> with the copied
                  text. If Cloudflare shows <strong>Rotate</strong> for a Secret, select it to
                  replace the value. Save and deploy.
                </p>
              ) : (
                <p>
                  Select <strong>Add variable</strong> and paste the copied line into{' '}
                  <strong>Key</strong>. Cloudflare fills both fields. Leave the type as Variable,
                  then select <strong>Add variable and deploy</strong>.
                </p>
              )}
              <details>
                <summary>If the setting looks different</summary>
                <p>
                  If adding the variable, paste{' '}
                  <code>
                    {status.secret_name}={claim.challenge}
                  </code>{' '}
                  into Key. If editing an existing variable, put only <code>{claim.challenge}</code>{' '}
                  into Value. There is no need to convert between Variable and Secret. Save and
                  deploy to this Worker's Production environment.
                </p>
              </details>
            </li>
            <li>Return to this page. It checks when you return; you can also check again below.</li>
          </ol>
          <p role="status">
            {status.value_format_issue === 'name_in_value'
              ? `Cloudflare Value includes ${status.secret_name}=. Replace Value with only the text from Copy value, then save and deploy.`
              : status.secret_present
                ? 'The deployed value does not match this request. Copy this page’s value again and update the same variable. If you just deployed, wait and verify again; keep this request open.'
                : `The current deployment does not contain ${status.secret_name}. Add it to this Worker and deploy, then verify again.`}
          </p>
          <button disabled={checking} onClick={check}>
            {checking ? 'Checking…' : 'Verify now'}
          </button>
        </>
      )}
      <p>
        This request expires at {new Date(claim.expires_at).toLocaleString()}. You can close this
        page and return to <code>/admin</code> in the same browser to continue.
      </p>
      <div className="actions">
        <button onClick={back}>Back to sign in</button>
        <button disabled={checking} onClick={restart}>
          Start a new request
        </button>
      </div>
    </>
  );
}
