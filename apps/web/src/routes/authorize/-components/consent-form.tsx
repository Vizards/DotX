import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import type { ConsentContext } from '@dotx/shared/http/consent';
import { authorizationMutation } from '../../../mutations/authorization.ts';
export function ConsentForm({ context }: { context: ConsentContext }) {
  const submit = useMutation(authorizationMutation());
  const decide = (decision: 'approve' | 'deny', access_code: string) =>
    submit.mutate(
      { transaction: context.transaction, decision, access_code },
      { onSuccess: ({ redirect }) => window.location.assign(redirect) },
    );
  const form = useForm({
    defaultValues: { access_code: '' },
    onSubmit: ({ value }) => decide('approve', value.access_code),
  });
  return (
    <>
      <h1>Connect to {context.service_name}</h1>
      <p>
        Client: <strong>{context.client_name}</strong>
      </p>
      <p>{context.sharing}</p>
      <p>
        Complete this authorization by{' '}
        <time dateTime={new Date(context.expires_at).toISOString()}>
          {new Date(context.expires_at).toLocaleString(undefined, { timeZoneName: 'short' })}
        </time>
        . If it expires, return to your Personal Agent to start again.
      </p>
      <details>
        <summary>View callback address</summary>
        <code>{context.redirect_uri}</code>
        {context.redirect_is_loopback && (
          <p>This returns to a local application. Check that you started this connection.</p>
        )}
      </details>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="access_code">
          {(field) => (
            <label>
              Access code{' '}
              <input
                name="access_code"
                autoComplete="off"
                autoCapitalize="characters"
                placeholder="K7M4Q2"
                spellCheck={false}
                required
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </label>
          )}
        </form.Field>
        <p>6 characters. Uppercase and lowercase both work.</p>
        {(submit.error || context.error) && (
          <p role="alert">{(submit.error ?? context.error)!.message}</p>
        )}
        <button type="submit" disabled={submit.isPending}>
          Connect
        </button>{' '}
        <button type="button" disabled={submit.isPending} onClick={() => decide('deny', '')}>
          Cancel
        </button>
      </form>
    </>
  );
}
