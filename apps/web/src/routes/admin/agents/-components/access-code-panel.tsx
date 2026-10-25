import { useState } from 'react';
import type { AccessCodeResult } from '@dotx/shared/http/admin';
import { Feedback } from '../../../../components/feedback.tsx';
export function AccessCodePanel({
  value,
  dismiss,
}: {
  value: AccessCodeResult;
  dismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value.access_code);
      setCopied(true);
    } catch {
      setError(new Error('Copy unavailable. Select and copy the code manually.'));
    }
  }
  return (
    <section className="panel">
      <h2>{value.connection.name}: access code</h2>
      <p>
        This code is shown only now. Copy it before leaving. It expires{' '}
        <time dateTime={new Date(value.expires_at).toISOString()}>
          {new Date(value.expires_at).toLocaleString(undefined, { timeZoneName: 'short' })}
        </time>
        .
      </p>
      <pre>{value.access_code}</pre>
      <div className="actions">
        <button
          onClick={() => {
            void copy();
          }}
        >
          {copied ? 'Copied' : 'Copy code'}
        </button>
        <button onClick={dismiss}>Close</button>
      </div>
      <Feedback error={error} />
      <p>
        Share this code with its deadline and the MCP address only for the intended Personal Agent.
        Enter it in the authorization page opened by that client. The connection becomes active on
        its first authenticated MCP request.
      </p>
    </section>
  );
}
