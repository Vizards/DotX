import { useForm } from '@tanstack/react-form';
export function NameForm({
  initial = '',
  create,
  busy,
  submit,
  cancel,
}: {
  initial?: string;
  create: boolean;
  busy: boolean;
  submit: (name: string) => Promise<boolean>;
  cancel?: () => void;
}) {
  const form = useForm({
    defaultValues: { name: initial, sharing: false },
    onSubmit: async ({ value }) => {
      if (await submit(value.name)) {
        if (create) form.reset();
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
      <form.Field name="name">
        {(field) => (
          <label>
            Name{' '}
            <input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
          </label>
        )}
      </form.Field>
      {create && (
        <form.Field
          name="sharing"
          validators={{
            onChange: ({ value }) => (value ? undefined : 'Confirm the shared access.'),
          }}
        >
          {(field) => (
            <label>
              <input
                type="checkbox"
                required
                checked={field.state.value}
                onChange={(e) => field.handleChange(e.target.checked)}
              />{' '}
              This Agent can use every approved Codex on this Server, including devices added later.
            </label>
          )}
        </form.Field>
      )}
      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
        {([canSubmit, isSubmitting]) => (
          <button disabled={busy || !canSubmit || isSubmitting}>
            {create ? 'Create connection' : 'Save name'}
          </button>
        )}
      </form.Subscribe>{' '}
      {cancel && (
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      )}
    </form>
  );
}
