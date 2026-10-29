import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
export type Variant = 'solid' | 'outline' | 'ghost' | 'danger' | 'solid-danger';

export function Button({
  variant = 'outline',
  small,
  large,
  block,
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  small?: boolean;
  large?: boolean;
  block?: boolean;
  busy?: boolean;
}) {
  const classes = [
    'btn',
    `btn--${variant}`,
    small ? 'btn--sm' : '',
    large ? 'btn--lg' : '',
    block ? 'btn--block' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button {...rest} className={classes} aria-busy={busy || undefined}>
      {children}
    </button>
  );
}

export function ButtonLink({
  to,
  href,
  variant = 'outline',
  small,
  large,
  children,
}: {
  to?: string;
  href?: string;
  variant?: Variant;
  small?: boolean;
  large?: boolean;
  children: ReactNode;
}) {
  const classes = ['btn', `btn--${variant}`, small ? 'btn--sm' : '', large ? 'btn--lg' : '']
    .filter(Boolean)
    .join(' ');
  if (to) {
    return (
      <Link to={to} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <a className={classes} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
