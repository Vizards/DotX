import { useMutation } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import type { LoginAuthority } from '../../api/login.ts';
import { passwordMutation, passkeyMutation } from '../../mutations/login.ts';
import { Alert } from '../ui/feedback.tsx';
import { Button, type Variant } from '../ui/button.tsx';
import { t } from '../../i18n/index.ts';

/** Password: signs in when no authority is given, sets one otherwise. */
export function PasswordForm({
  auth,
  onSubmit,
  submitLabel,
  autoFocus,
}: {
  auth?: LoginAuthority;
  onSubmit: () => void;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const mutation = useMutation(passwordMutation(auth));
  const form = useForm({
    defaultValues: { password: '', confirm: '' },
    validators: {
      onSubmit: ({ value }) =>
        auth && value.password !== value.confirm ? t.forms.passwordMismatch : undefined,
    },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync(value.password);
        form.reset();
        onSubmit();
      } catch {
        // Keep the draft and show the mutation error in this form.
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="password">
        {(field) => (
          <label className="field">
            <span>{auth ? t.forms.newPassword : t.login.passwordLabel}</span>
            <input
              type="password"
              required
              autoComplete={auth ? 'new-password' : 'current-password'}
              autoFocus={autoFocus}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>
      {auth && (
        <form.Field name="confirm">
          {(field) => (
            <label className="field">
              <span>{t.forms.confirmPassword}</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>
      )}
      <form.Subscribe
        selector={(state) => [state.errors, state.values.password, state.isSubmitting] as const}
      >
        {([errors, password, submitting]) => (
          <>
            <Alert error={errors[0] ?? mutation.error} />
            <Button variant="solid" block large disabled={submitting || !password}>
              {submitting
                ? t.forms.working
                : (submitLabel ?? (auth ? t.forms.savePassword : t.login.passwordSignIn))}
            </Button>
          </>
        )}
      </form.Subscribe>
    </form>
  );
}

/** Passkey: creates one under an authority, otherwise signs in with one. */
export function PasskeyForm({
  auth,
  onSubmit,
  name: withName,
  label,
  variant,
}: {
  auth?: LoginAuthority;
  onSubmit: () => void;
  name?: boolean;
  label?: string;
  variant?: Variant;
}) {
  const mutation = useMutation(passkeyMutation(auth));
  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync(value.name);
        form.reset();
        onSubmit();
      } catch {
        // The mutation renders the error below.
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {withName && (
        <form.Field name="name">
          {(field) => (
            <label className="field">
              <span>{t.security.passkeyNameLabel}</span>
              <input
                value={field.state.value}
                onBlur={field.handleBlur}
                maxLength={64}
                placeholder={t.security.passkeyNamePlaceholder}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>
      )}
      <Alert error={mutation.error} />
      <Button
        variant={variant ?? (withName ? 'outline' : 'solid')}
        block
        large
        disabled={mutation.isPending}
      >
        {mutation.isPending ? t.security.passkeyWaiting : (label ?? t.security.passkeyCreate)}
      </Button>
    </form>
  );
}
