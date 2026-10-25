import type { ReactNode } from 'react';
import packageInfo from '../../package.json';
export function Layout({ children }: { children: ReactNode }) {
  return (
    <main>
      <header>
        <img src="/branding/dotx.png" alt="" width="36" height="36" />
        <strong>DotX</strong>
      </header>
      {children}
      <footer>
        <a href={`https://github.com/Vizards/DotX/blob/v${packageInfo.version}/docs/index.md`}>
          Agent guides
        </a>
      </footer>
    </main>
  );
}
export function Guide({ path, children }: { path: string; children: ReactNode }) {
  return (
    <a href={`https://github.com/Vizards/DotX/blob/v${packageInfo.version}/docs/${path}`}>
      {children}
    </a>
  );
}
