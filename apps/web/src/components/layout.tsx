import type { ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { logoutMutation } from '../mutations/session.ts';
import { t } from '../i18n/index.ts';
import { Alert } from './ui/feedback.tsx';
import { Segmented, type NavItem } from './ui/segmented.tsx';
import { guideUrl, releaseUrl, repoUrl } from '../lib/guides.ts';

const items: NavItem[] = [
  { to: '/admin', label: t.nav.overview },
  { to: '/admin/devices', label: t.nav.devices, short: t.nav.devicesShort },
  { to: '/admin/agents', label: t.nav.agents, short: t.nav.agentsShort },
  { to: '/admin/security', label: t.nav.security, short: t.nav.securityShort },
];

/** Authenticated frame: brand row, segmented navigation, page. */
export function AdminShell({
  version,
  wire,
  csrf,
  children,
}: {
  version: string;
  wire: number;
  csrf: string;
  children: ReactNode;
}) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const logout = useMutation(logoutMutation());
  // Longest match wins: '/admin' is a prefix of every other tab, so finding the
  // first match would pin the knob to Overview forever.
  const active =
    items
      .filter((item) => path === item.to || path.startsWith(`${item.to}/`))
      .sort((a, b) => b.to.length - a.to.length)[0]?.to ?? '/admin';

  return (
    <div className="shell">
      <header className="brandbar">
        <span className="brand">
          <img src="/branding/dotx.png" alt="" />
          DotX
        </span>
        <div className="right">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={logout.isPending}
            onClick={() =>
              logout.mutate(csrf, { onSuccess: () => window.location.assign('/admin') })
            }
          >
            {t.common.signOut}
          </button>
        </div>
      </header>
      <div className="segmented-row">
        <Segmented items={items} active={active} />
      </div>
      <main className="page">
        {logout.error ? <Alert error={logout.error} /> : null}
        {children}
      </main>
      <Footer version={version} wire={wire} />
    </div>
  );
}

/**
 * What is running, and where it comes from. The version opens its own release
 * notes; the mark opens the repository.
 */
export function Footer({ version, wire }: { version: string; wire: number }) {
  return (
    <footer className="footer">
      <a
        className="footer-repo"
        href={repoUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="GitHub"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
      </a>
      <a className="mono" href={releaseUrl(version)} target="_blank" rel="noreferrer">
        v{version}
      </a>
      <span className="mono">wire {wire}</span>
    </footer>
  );
}

export function GuideLink({
  path,
  version,
  className,
  children,
}: {
  path: string;
  version: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a className={className} href={guideUrl(path, version)} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
