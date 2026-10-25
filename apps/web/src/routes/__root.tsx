import { createRootRoute, Outlet, Link } from '@tanstack/react-router';
import { Layout } from '../components/layout.tsx';
import { Feedback } from '../components/feedback.tsx';
export const Route = createRootRoute({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
  errorComponent: ({ error, reset }) => (
    <Feedback error={error instanceof Error ? error : new Error(String(error))} retry={reset} />
  ),
  notFoundComponent: () => (
    <p>
      Page not found. <Link to="/admin">Open management</Link>
    </p>
  ),
});
