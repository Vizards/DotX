import { useForm } from '@tanstack/react-form';
export function RenameForm({
  initial,
  busy,
  submit,
  cancel,
}: {
  initial: string;
  busy: boolean;
  submit: (name: string) => Promise<void>;
  cancel: () => void;
}) {
  const form = useForm({
    defaultValues: { name: initial },
    onSubmit: async ({ value }) => submit(value.name),
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="name">
        {(field) => (
          <label>
            Name{' '}
            <input
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
          </label>
        )}
      </form.Field>
      <button disabled={busy}>Save name</button>{' '}
      <button type="button" disabled={busy} onClick={cancel}>
        Cancel
      </button>
    </form>
  );
}
