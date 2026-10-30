import { useRef, useEffect, type ReactNode } from 'react';
import { t } from '../../i18n/index.ts';
export function Dialog({
  open,
  title,
  kind = 'alert',
  wide = false,
  showClose = true,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  kind?: 'alert' | 'modal';
  /** A panel that carries a whole flow needs more than 460px. */
  wide?: boolean;
  /** Hide the corner button when the dialog already has a Cancel action. */
  showClose?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // A dialog that asks for input should start in that input, rather than
      // whichever button happens to come first.
      dialog.querySelector<HTMLElement>('input:not([type="hidden"]), textarea')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', cancel);
    return () => dialog.removeEventListener('cancel', cancel);
  }, [onClose]);

  return (
    <dialog ref={ref} className="sheet" aria-label={title}>
      {open && (
        <div className="sheet-panel" data-kind={kind} data-wide={wide || undefined}>
          <h2>{title}</h2>
          {showClose && (
            <button
              type="button"
              className="sheet-close"
              aria-label={t.common.close}
              onClick={onClose}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M3.5 3.5l9 9m0-9l-9 9"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          {children}
        </div>
      )}
    </dialog>
  );
}
