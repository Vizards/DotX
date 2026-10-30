import { errorText, t } from '../../i18n/index.ts';
import { Button } from './button.tsx';
export function Alert({ error, retry }: { error?: unknown; retry?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert" role="alert">
      <span>{errorText(error)}</span>
      {retry && (
        <Button small onClick={retry}>
          {t.common.retry}
        </Button>
      )}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status" aria-label={t.common.loading}>
      <span className="spinner" />
    </div>
  );
}
