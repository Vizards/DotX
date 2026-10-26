import { useQuery } from '@tanstack/react-query';
import { loginMethodsQuery } from '../../queries/login.ts';
import { Feedback, Loading } from '../../components/feedback.tsx';
import { PasswordForm, PasskeyForm } from '../../components/login-methods.tsx';
export function Login() {
  const methods = useQuery(loginMethodsQuery());
  if (methods.isPending) return <Loading />;
  if (methods.error)
    return (
      <Feedback
        error={methods.error}
        retry={() => {
          void methods.refetch();
        }}
      />
    );
  const completed = () => window.location.reload();
  return (
    <>
      <h1>Manage DotX</h1>
      <p>{methods.data.worker}</p>
      {!methods.data.configured ? (
        <>
          <p>
            Browser login has not been set up. Ask an Agent with Wrangler management access to this
            Worker for a setup link, then choose a password or passkey.
          </p>
          <button
            onClick={() => {
              void methods.refetch();
            }}
          >
            Check again
          </button>
        </>
      ) : (
        <>
          {methods.data.passkey_enabled && <PasskeyForm completed={completed} />}
          {methods.data.password_enabled && <PasswordForm completed={completed} />}
          <p>
            Lost access? Ask an Agent with Wrangler management access to this Worker for a
            browser-login reset link.
          </p>
        </>
      )}
    </>
  );
}
