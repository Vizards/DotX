import { createFileRoute, useLocation } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { setupQuery } from '../../../queries/setup.ts';
import { setupMutation } from '../../../mutations/setup.ts';
import { queryClient } from '../../../query-client.ts';
import { Feedback, Loading } from '../../../components/feedback.tsx';

export const Route = createFileRoute('/setup/admin/')({ component: Setup });

function Setup() {
  const secret = useLocation({ select: (location) => location.hash });
  const status = useQuery(setupQuery(secret));
  const mutation = useMutation(setupMutation(secret));
  const [error, setError] = useState<Error | null>(null);
  const form = useForm({
    defaultValues: { token: '' },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const result = await mutation.mutateAsync(value.token);
        queryClient.setQueryData(setupQuery(secret).queryKey, result);
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure
            : new Error('Setup did not complete. Check its status before retrying.'),
        );
      } finally {
        form.reset();
        mutation.reset();
      }
    },
  });
  if (status.isPending) return <Loading />;
  if (status.error)
    return (
      <Feedback
        error={status.error}
        retry={() => {
          void status.refetch();
        }}
      />
    );
  const config = status.data;
  if (config.configured)
    return (
      <>
        <h1>Cloudflare login is ready</h1>
        <p>
          You can now sign in to manage DotX. Revoke the temporary API token in Cloudflare, or let
          it expire.
        </p>
        <a className="button" href="/admin/login">
          Sign in with Cloudflare
        </a>
      </>
    );
  return (
    <>
      <h1>Enable Cloudflare login</h1>
      <p>
        Worker: <strong>{config.worker}</strong>
        <br />
        Cloudflare account: <code>{config.account_id}</code>
      </p>
      <h2>1. Create a temporary API token</h2>
      <p>
        The link below opens Cloudflare in another tab and preselects{' '}
        <strong>OAuth Client Write</strong> for this account. Check that this is the only
        permission.
      </p>
      <p>
        Under <strong>Token expiration → Custom</strong>, set Start to now and End to one hour
        later, then Apply. Cloudflare does not prefill the expiry from this link. Review and create
        the token.
      </p>
      <a className="button" href={config.token_url} target="_blank" rel="noopener noreferrer">
        Create token in Cloudflare ↗
      </a>
      <p>
        <strong>Keep this DotX tab open.</strong> Copy the token in Cloudflare, then return here to
        paste it. Do not send it to your Agent or paste it in chat.
      </p>
      <h2>2. Paste the token here</h2>
      <p>
        This Worker uses it once to create its Cloudflare login application. DotX does not save the
        API token. It saves the login application's configuration in this Worker's storage.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="token">
          {(field) => (
            <label>
              Temporary API token{' '}
              <input
                type="password"
                required
                autoComplete="off"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </label>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(busy) => <button disabled={busy}>{busy ? 'Setting up…' : 'Finish setup'}</button>}
        </form.Subscribe>
      </form>
      <Feedback error={error} />
      <button
        type="button"
        onClick={() => {
          void status.refetch();
        }}
      >
        Check setup status
      </button>
    </>
  );
}
