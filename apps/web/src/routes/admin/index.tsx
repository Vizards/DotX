import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { sessionQuery } from '../../queries/session.ts';
import { devicesQuery } from '../../queries/devices.ts';
import { agentsQuery } from '../../queries/agents.ts';
import { Feedback } from '../../components/feedback.tsx';
import { Guide } from '../../components/layout.tsx';
export const Route = createFileRoute('/admin/')({ component: Overview });
function Overview() {
  const session = useQuery(sessionQuery());
  const devices = useQuery(devicesQuery());
  const agents = useQuery(agentsQuery());
  if (!session.data?.authenticated) return null;
  const service = session.data.service;
  return (
    <>
      <h1>Overview</h1>
      <p>{service.origin}</p>
      <p>Server {service.version}</p>
      <Feedback
        error={devices.error ?? agents.error}
        retry={() => {
          void devices.refetch();
          void agents.refetch();
        }}
      />
      <p>
        Codex:{' '}
        {devices.data ? devices.data.devices.filter((d) => d.status === 'approved').length : '…'} ·
        Personal Agents: {agents.data ? agents.data.agents.filter((a) => !a.revoked).length : '…'}
      </p>
      <Guide path="server/update.md">Update guide</Guide>
    </>
  );
}
