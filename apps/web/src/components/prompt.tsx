import { Alert } from './ui/feedback.tsx';
import { Button, type Variant } from './ui/button.tsx';
import { useCopy } from '../hooks/use-copy.ts';
import { t } from '../i18n/index.ts';

/** The prompt box doubles as the instruction: what is copied is what is shown. */
export function Prompt({
  value,
  label = t.common.copyPrompt,
  variant = 'solid',
}: {
  value: string;
  label?: string;
  variant?: Variant;
}) {
  const copy = useCopy();

  return (
    <>
      <div className="prompt-box">{value}</div>
      <Button variant={variant} block large onClick={() => void copy.copy(value)}>
        {copy.copied === value ? `✓ ${t.common.copied}` : label}
      </Button>
      <Alert error={copy.error} />
    </>
  );
}
