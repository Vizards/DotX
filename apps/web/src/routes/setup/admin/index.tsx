import { createFileRoute, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { setupQuery } from '../../../queries/setup.ts';
import { PasswordForm, PasskeyForm } from '../../../components/login-methods.tsx';
import { Feedback, Loading } from '../../../components/feedback.tsx';
export const Route = createFileRoute('/setup/admin/')({ component: Setup });
function Setup() {
  const secret = useLocation({ select: (location) => location.hash });
  const status = useQuery(setupQuery(secret));
  if (status.isPending) return <Loading />;
  if (status.error)
    return (
      <>
        <h1>Browser login setup</h1>
        <Feedback error={status.error} />
        <p>
          This link may have expired or already been used. <a href="/admin">Try signing in</a>, or
          ask your Agent for a new link.
        </p>
      </>
    );
  const completed = () => window.location.replace('/admin/security');
  return (
    <>
      <h1>{status.data.reset ? 'Reset browser login' : 'Set up browser login'}</h1>
      <p>
        DotX: <strong>{status.data.worker}</strong>
      </p>
      <p>Choose a password or a passkey. You can add the other method later.</p>
      {status.data.reset && (
        <p role="alert">
          Saving a new login method removes the previous password and all passkeys, and signs out
          every browser. Connected Codex and Personal Agents are preserved.
        </p>
      )}
      <h2>Use a passkey</h2>
      <p>Your browser or password manager will guide you through creating it.</p>
      <PasskeyForm auth={{ setup: secret }} completed={completed} />
      <h2>Use a password</h2>
      <PasswordForm auth={{ setup: secret }} completed={completed} />
    </>
  );
}
