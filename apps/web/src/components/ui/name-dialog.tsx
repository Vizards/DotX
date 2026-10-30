import { useForm } from '@tanstack/react-form';
import { Dialog } from './dialog.tsx';
import { Button } from './button.tsx';
import { Alert } from './feedback.tsx';
import { t } from '../../i18n/index.ts';

/** Shared editing mechanics; the owning route supplies the operation and outcome. */
export function NameDialog({
  title,
  label,
  initialValue,
  placeholder,
  changedOnly = true,
  submitLabel = t.forms.save,
  busy,
  error,
  onSave,
  onClose,
}: {
  title: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  changedOnly?: boolean;
  submitLabel?: string;
  busy: boolean;
  error?: unknown;
  onSave: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const form = useForm({
    defaultValues: { name: initialValue },
    onSubmit: async ({ value }) => {
      if (!value.name.trim()) return;
      try {
        await onSave(value.name.trim());
        onClose();
      } catch {
        /* The mutation's error stays beside this draft. */
      }
    },
  });
  return (
    <Dialog open title={title} kind="modal" showClose={false} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="name">
          {(field) => (
            <label className="field">
              <span>{label}</span>
              <input
                value={field.state.value}
                autoFocus
                maxLength={64}
                placeholder={placeholder}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>
        <Alert error={error} />
        <div className="acts">
          <Button type="button" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <form.Subscribe selector={(state) => [state.values.name, state.isSubmitting] as const}>
            {([name, submitting]) => (
              <Button
                variant="solid"
                disabled={
                  busy || submitting || !name.trim() || (changedOnly && name === initialValue)
                }
              >
                {submitLabel}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </Dialog>
  );
}
