import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { loginMethodsQuery } from '../../queries/login.ts';
import { Feedback, Loading } from '../../components/feedback.tsx';
import { PasswordForm, PasskeyForm } from '../../components/login-methods.tsx';
import { claimQuery } from '../../queries/claim.ts';
import { startClaimMutation } from '../../mutations/claim.ts';
import { Claim } from './-claim.tsx';
export function Login() {
  const client = useQueryClient();
  const claim = useQuery(claimQuery());
  const start = useMutation(startClaimMutation());
  const [showLogin, setShowLogin] = useState(false);
  const methods = useQuery(loginMethodsQuery());
  const begin = async (restart = false) => {
    try {
      await client.cancelQueries({ queryKey: claimQuery().queryKey });
      const status = await start.mutateAsync(restart);
      client.setQueryData(claimQuery().queryKey, status);
      setShowLogin(false);
    } catch {
      /* Render the mutation error below. */
    }
  };
  if (methods.isPending || claim.isPending) return <Loading />;
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
  if (claim.data?.claim && !showLogin)
    return (
      <>
        <Claim
          status={claim.data}
          checking={claim.isFetching || start.isPending}
          check={() => {
            void claim.refetch();
          }}
          restart={() => {
            void begin(true);
          }}
          back={() => setShowLogin(true)}
        />
        <Feedback error={claim.error ?? start.error} />
      </>
    );
  return (
    <>
      <h1>Manage DotX</h1>
      <p>{methods.data.worker}</p>
      {!methods.data.configured ? (
        <>
          <p>Set up a password or passkey using your Cloudflare management access.</p>
          <button
            disabled={start.isPending}
            onClick={() => {
              void begin();
            }}
          >
            Set up browser login
          </button>
        </>
      ) : (
        <>
          {methods.data.passkey_enabled && <PasskeyForm completed={completed} />}
          {methods.data.password_enabled && <PasswordForm completed={completed} />}
          <button
            disabled={start.isPending}
            onClick={() => {
              void begin();
            }}
          >
            Unable to sign in? Reset browser login
          </button>
        </>
      )}
      <p>An Agent with Wrangler management access can also give you a setup or recovery link.</p>
      <Feedback error={claim.error ?? start.error} />
    </>
  );
}
