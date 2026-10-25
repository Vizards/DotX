import { Link } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { logoutMutation } from '../../mutations/session.ts';
import { Feedback } from '../../components/feedback.tsx';
export function Navigation({ csrf }: { csrf: string }) {
  const logout = useMutation(logoutMutation());
  return (
    <>
      <nav>
        <Link to="/admin">Overview</Link>
        <Link to="/admin/devices">Codex</Link>
        <Link to="/admin/agents">Personal Agents</Link>
        <button disabled={logout.isPending} onClick={() => logout.mutate(csrf)}>
          Sign out
        </button>
      </nav>
      <Feedback error={logout.error} />
    </>
  );
}
