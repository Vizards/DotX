import { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '@tanstack/react-router';
import { useCompact } from '../../hooks/use-compact.ts';
import { t } from '../../i18n/index.ts';
/** One row action. Secondary ones fold into "more" on wide screens. */
export interface RowAction {
  label: string;
  on?: () => void;
  to?: string;
  href?: string;
  danger?: boolean;
  secondary?: boolean;
}

/** Text-weight actions; the rare extras live behind a click. */
export function RowActions({ actions, title }: { actions: RowAction[]; title: string }) {
  // A phone has no hover and no width for several links: one button opens a
  // sheet where every action is a full-width row with a real touch target.
  const compact = useCompact();
  return compact ? (
    <MobileActions actions={actions} title={title} />
  ) : (
    <InlineActions actions={actions} />
  );
}

function InlineActions({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; right: number } | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const primary = actions.filter((action) => !action.secondary);
  const more = actions.filter((action) => action.secondary);

  // The menu is portalled: a table row cannot host a floating layer, because
  // any scrolling or clipping ancestor between them would cut it off.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = toggle.current?.getBoundingClientRect();
    if (!anchor) return;
    const height = menu.current?.offsetHeight ?? 0;
    const below = anchor.bottom + 6;
    const fits = below + height <= window.innerHeight - 8;
    setBox({
      top: fits ? below : Math.max(8, anchor.top - 6 - height),
      right: Math.max(8, window.innerWidth - anchor.right),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || toggle.current?.contains(target)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    // The menu is fixed to the viewport; once the page moves, it would float
    // away from its row, so it closes the way a native menu does.
    const dismiss = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);

  return (
    <div className="row-actions">
      {primary.map((action) => (
        <Action key={action.label} action={action} />
      ))}
      {more.length > 0 && (
        <>
          <button
            ref={toggle}
            type="button"
            className="act more-toggle"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {t.common.more}
          </button>
          {open &&
            createPortal(
              <div
                className="more-menu"
                ref={menu}
                style={{ top: box?.top ?? 0, right: box?.right ?? 0 }}
              >
                {more.map((action) => (
                  <Action
                    key={action.label}
                    action={action}
                    onDone={() => {
                      setOpen(false);
                      // The item is about to unmount; leave focus on the trigger
                      // so a dialog it opened has somewhere to hand focus back.
                      toggle.current?.focus();
                    }}
                  />
                ))}
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  );
}

/** The whole row's actions behind one button, for touch. */
function MobileActions({ actions, title }: { actions: RowAction[]; title: string }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open]);

  const dismiss = () => {
    setOpen(false);
    toggle.current?.focus();
  };

  return (
    <div className="row-actions">
      <button
        ref={toggle}
        type="button"
        className="row-more"
        aria-expanded={open}
        aria-label={t.common.actions}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="4" cy="10" r="1.6" fill="currentColor" />
          <circle cx="10" cy="10" r="1.6" fill="currentColor" />
          <circle cx="16" cy="10" r="1.6" fill="currentColor" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            className="sheet-layer"
            onMouseDown={(event) => {
              if (!sheet.current?.contains(event.target as Node)) dismiss();
            }}
          >
            <div className="action-sheet" ref={sheet} role="dialog" aria-label={t.common.actions}>
              {title && <p className="action-sheet-title">{title}</p>}
              {actions.map((action) => (
                <Action
                  key={action.label}
                  action={action}
                  sheet
                  onDone={() => {
                    setOpen(false);
                    toggle.current?.focus();
                  }}
                />
              ))}
              <button type="button" className="action-sheet-cancel" onClick={dismiss}>
                {t.common.cancel}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Action({
  action,
  onDone,
  sheet,
}: {
  action: RowAction;
  onDone?: () => void;
  /** Inside the phone action sheet the row carries its own touch target. */
  sheet?: boolean;
}) {
  const className = `act${action.danger ? ' act--danger' : ''}${sheet ? ' act--sheet' : ''}`;
  if (action.to)
    return (
      <Link className={className} to={action.to} onClick={onDone}>
        {action.label}
      </Link>
    );
  if (action.href)
    return (
      <a className={className} href={action.href} target="_blank" rel="noreferrer" onClick={onDone}>
        {action.label}
      </a>
    );
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        action.on?.();
        onDone?.();
      }}
    >
      {action.label}
    </button>
  );
}
