import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { sessionQuery } from '../../../queries/session.ts';
import { securityQuery } from '../../../queries/login.ts';
import { removeLoginMutation } from '../../../mutations/login.ts';
import { PasswordForm, PasskeyForm } from '../../../components/login-methods.tsx';
import { Feedback, Loading } from '../../../components/feedback.tsx';
export const Route = createFileRoute('/admin/security/')({ component: Security });
function Security() {
  const session = useQuery(sessionQuery());
  const security = useQuery(securityQuery());
  const csrf = session.data?.authenticated ? session.data.csrf_token! : '';
  const remove = useMutation(removeLoginMutation(csrf));
  const completed = () => window.location.reload();
  const removeMethod = (id?: string) => {
    remove.mutate(id, { onSuccess: completed });
  };
  if (security.isPending) return <Loading />;
  if (security.error)
    return (
      <Feedback
        error={security.error}
        retry={() => {
          void security.refetch();
        }}
      />
    );
  const info = security.data;
  return (
    <>
      <h1>Browser login</h1>
      <p>
        Password and passkeys give the same management access to this DotX service. Changing a login
        method signs out other browsers; this browser stays signed in.
      </p>
      <h2>Password</h2>
      <p>{info.password_enabled ? 'A password is configured.' : 'No password is configured.'}</p>
      <PasswordForm auth={{ csrf }} completed={completed} />
      {info.password_enabled && (
        <button disabled={remove.isPending || !info.passkeys.length} onClick={() => removeMethod()}>
          Remove password
        </button>
      )}
      <h2>Passkeys</h2>
      <ul>
        {info.passkeys.map((passkey) => (
          <li key={passkey.id}>
            {passkey.name} · Added {new Date(passkey.created_at).toLocaleDateString()}{' '}
            <button
              disabled={remove.isPending || (!info.password_enabled && info.passkeys.length === 1)}
              onClick={() => removeMethod(passkey.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <PasskeyForm auth={{ csrf }} completed={completed} />
      <p>
        Keep at least one login method. If you lose all of them, an Agent with Wrangler management
        access can provide a reset link.
      </p>
      <Feedback error={remove.error} />
    </>
  );
}
