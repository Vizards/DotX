import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { LoginAuthority } from '../api/login.ts';
import { passwordMutation, passkeyMutation } from '../mutations/login.ts';
import { Feedback } from './feedback.tsx';

export function PasswordForm({
  auth,
  completed,
}: {
  auth?: LoginAuthority;
  completed: () => void;
}) {
  const mutation = useMutation(passwordMutation(auth));
  const [error, setError] = useState<Error | null>(null);
  const form = useForm({
    defaultValues: { password: '', confirm: '' },
    onSubmit: async ({ value }) => {
      setError(null);
      if (auth && value.password !== value.confirm) {
        setError(new Error('The passwords do not match.'));
        return;
      }
      try {
        await mutation.mutateAsync(value.password);
        completed();
      } catch (failure) {
        setError(failure instanceof Error ? failure : new Error('Password operation failed.'));
      } finally {
        form.reset();
        mutation.reset();
      }
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="password">
        {(field) => (
          <label>
            {auth ? 'New password' : 'Password'}{' '}
            <input
              type="password"
              autoComplete={auth ? 'new-password' : 'current-password'}
              required
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
          </label>
        )}
      </form.Field>
      {auth && (
        <form.Field name="confirm">
          {(field) => (
            <label>
              Confirm password{' '}
              <input
                type="password"
                autoComplete="new-password"
                required
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </label>
          )}
        </form.Field>
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(busy) => (
          <button disabled={busy}>
            {busy ? 'Please wait…' : auth ? 'Save password' : 'Sign in with password'}
          </button>
        )}
      </form.Subscribe>
      <Feedback error={error} />
    </form>
  );
}
export function PasskeyForm({ auth, completed }: { auth?: LoginAuthority; completed: () => void }) {
  const mutation = useMutation(passkeyMutation(auth));
  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync(value.name);
        completed();
      } catch {
        /* The mutation renders the error. */
      }
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      {auth && (
        <form.Field name="name">
          {(field) => (
            <label>
              Passkey name (optional){' '}
              <input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder="For example, iCloud Keychain"
              />
            </label>
          )}
        </form.Field>
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(busy) => (
          <button disabled={busy}>
            {busy
              ? 'Follow your browser’s prompt…'
              : auth
                ? 'Create passkey'
                : 'Sign in with passkey'}
          </button>
        )}
      </form.Subscribe>
      <Feedback error={mutation.error} />
    </form>
  );
}
