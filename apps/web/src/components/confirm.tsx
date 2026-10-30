import { useCallback, useState, type ReactNode } from 'react';
import { Alert } from './ui/feedback.tsx';
import { Button } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';
import { ConfirmContext, type ConfirmRequest } from './confirm-context.ts';
import { t } from '../i18n/index.ts';

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

/** A designed replacement for window.confirm; the dialog owns focus and Escape. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ask = useCallback(
    (next: Omit<ConfirmRequest, 'resolve'>) =>
      new Promise<boolean>((resolve) => {
        setError(null);
        setRequest({ ...next, resolve });
      }),
    [],
  );

  const settle = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await request?.onConfirm?.();
      settle(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog
        open={request !== null}
        title={request?.title ?? ''}
        showClose={false}
        onClose={() => {
          if (!busy) settle(false);
        }}
      >
        <p>{request?.body}</p>
        <Alert error={error} />
        <div className="acts">
          <Button disabled={busy} onClick={() => settle(false)}>
            {request?.cancel ?? t.common.cancel}
          </Button>
          <Button
            variant={request?.danger ? 'solid-danger' : 'solid'}
            disabled={busy}
            busy={busy}
            onClick={() => void submit()}
          >
            {request?.confirm}
          </Button>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
