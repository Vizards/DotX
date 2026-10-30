import { createRootRoute, Outlet, Link } from '@tanstack/react-router';
import { Alert } from '../components/ui/feedback.tsx';
import { ConfirmProvider } from '../components/confirm.tsx';

export const Route = createRootRoute({
  component: () => (
    <ConfirmProvider>
      <Outlet />
    </ConfirmProvider>
  ),
  errorComponent: ({ error, reset }) => (
    <div className="focus-shell">
      <div className="narrow">
        <Alert error={error instanceof Error ? error : new Error(String(error))} retry={reset} />
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="focus-shell">
      <div className="auth-card">
        <h1>404</h1>
        <p className="lede">This page does not exist.</p>
        <Link className="btn btn--solid btn--lg btn--block" to="/admin">
          DotX
        </Link>
      </div>
    </div>
  ),
});
