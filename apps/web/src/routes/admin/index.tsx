import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { agentsQuery } from '../../queries/agents.ts';
import { devicesQuery, requestsQuery } from '../../queries/devices.ts';
import { sessionQuery } from '../../queries/session.ts';
import { authorizationRequestsQuery } from '../../queries/authorization.ts';
import { useNow } from '../../hooks/use-now.ts';
import { fill, t } from '../../i18n/index.ts';
import { Alert, Loading } from '../../components/ui/feedback.tsx';
import { Button, ButtonLink } from '../../components/ui/button.tsx';
import { Dialog } from '../../components/ui/dialog.tsx';
import { Prompt } from '../../components/prompt.tsx';
import { NewDeviceDialog } from '../../components/new-device.tsx';
import { NewAgentDialog } from '../../components/new-agent.tsx';

export const Route = createFileRoute('/admin/')({ component: Overview });

/** Which hand-off is open. Two of them are prompts; one carries a device. */
type Sheet =
  | { kind: 'mac' }
  | { kind: 'agent' }
  | { kind: 'wire'; name: string; wire: number; server: number }
  | null;

function Overview() {
  const session = useQuery(sessionQuery());
  const devices = useQuery(devicesQuery());
  const requests = useQuery(requestsQuery());
  const agents = useQuery(agentsQuery());
  const agentRequests = useQuery(authorizationRequestsQuery());
  const now = useNow();
  const [sheet, setSheet] = useState<Sheet>(null);

  const origin = session.data?.authenticated ? session.data.service.origin : window.location.origin;
  const error = devices.error ?? requests.error ?? agents.error ?? agentRequests.error;
  const retry = () => {
    if (devices.error) void devices.refetch();
    if (requests.error) void requests.refetch();
    if (agents.error) void agents.refetch();
    if (agentRequests.error) void agentRequests.refetch();
  };

  if (devices.isPending || requests.isPending || agents.isPending || agentRequests.isPending)
    return <Loading />;

  const approved = (devices.data?.devices ?? []).filter((d) => d.status === 'approved');
  const pending = (requests.data?.requests ?? []).filter(
    (r) => r.status === 'pending' && r.expires_at > now,
  );

  // One list, ordered by what blocks the user. Each entry carries its own action. 原则 2
  const attention: { key: string; text: string; action: string; to?: string; on?: () => void }[] =
    [];

  for (const request of pending)
    attention.push({
      key: `request:${request.operation_id}`,
      text: t.overview.pendingRequest.replace('{name}', request.name),
      action: t.overview.review,
      to: '/admin/devices',
    });

  for (const request of agentRequests.data?.requests ?? [])
    if (request.expires_at > now)
      attention.push({
        key: `agent:${request.transaction}`,
        text: t.overview.pendingRequest.replace('{name}', request.client_name),
        action: t.overview.review,
        to: '/admin/agents',
      });

  // The Server cannot send anything to an incompatible Mac, so the only channel
  // left is a prompt the user carries over by hand.
  for (const device of approved)
    if (device.compatible === false)
      attention.push({
        key: `wire:${device.device_id}`,
        text: t.overview.incompatible
          .replace('{name}', device.name)
          .replace('{wire}', String(device.wire_protocol ?? '?'))
          .replace('{server}', String(device.server_wire_protocol)),
        action: t.overview.incompatibleNext,
        on: () =>
          setSheet({
            kind: 'wire',
            name: device.name,
            wire: device.wire_protocol ?? 0,
            server: device.server_wire_protocol,
          }),
      });

  return (
    <>
      <div className="page-head">
        <h1>{t.overview.title}</h1>
        {/* What the owner of this Server is running, not how each one is doing. */}
        <div className="stat-row">
          <div className="stat">
            <b>{devices.error ? 'N/A' : approved.length}</b>
            <span>{t.overview.statCodex}</span>
          </div>
          <div className="stat">
            <b>
              {agents.error
                ? 'N/A'
                : (agents.data?.agents.filter((agent) => !agent.revoked).length ?? 0)}
            </b>
            <span>{t.overview.statAgents}</span>
          </div>
        </div>
      </div>

      <section className="motives" aria-label={t.overview.title}>
        {error ? (
          <article className="motive">
            <Alert error={error} retry={retry} />
          </article>
        ) : attention.length ? (
          <article className="motive" data-tone="attn">
            <h2>{t.overview.attentionTitle}</h2>
            <ul className="attention">
              {attention.map((item) => (
                <li key={item.key}>
                  <span>{item.text}</span>
                  {item.to ? (
                    <Link className="next" to={item.to}>
                      {item.action}
                    </Link>
                  ) : (
                    <button type="button" className="next next--button" onClick={item.on}>
                      {item.action}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ) : (
          <article className="motive" data-tone="live">
            <h2>{t.overview.okTitle}</h2>
            <p>{t.overview.okBody}</p>
            <ButtonLink to="/admin/devices" variant="outline" small>
              {t.nav.devices}
            </ButtonLink>
          </article>
        )}

        <article className="motive">
          <h2>{t.overview.addMacTitle}</h2>
          <p>{t.overview.addMacBody}</p>
          <Button variant="solid" small onClick={() => setSheet({ kind: 'mac' })}>
            {t.overview.addMacAction}
          </Button>
        </article>

        <article className="motive">
          <h2>{t.overview.addAgentTitle}</h2>
          <p>{t.overview.addAgentBody}</p>
          <Button variant="solid" small onClick={() => setSheet({ kind: 'agent' })}>
            {t.overview.addAgentAction}
          </Button>
        </article>
      </section>

      <NewDeviceDialog
        open={sheet?.kind === 'mac'}
        origin={origin}
        onClose={() => setSheet(null)}
      />

      {session.data?.authenticated && (
        <NewAgentDialog
          open={sheet?.kind === 'agent'}
          title={t.overview.addAgentTitle}
          service={session.data.service}
          onClose={() => setSheet(null)}
        />
      )}

      <Dialog
        open={sheet?.kind === 'wire'}
        title={t.overview.wireSheetTitle}
        kind="modal"
        onClose={() => setSheet(null)}
      >
        <p>
          {fill(t.overview.wireSheetBody, {
            name: sheet?.kind === 'wire' ? sheet.name : '',
            wire: sheet?.kind === 'wire' ? sheet.wire : 0,
            server: sheet?.kind === 'wire' ? sheet.server : 0,
          })}
        </p>
        <Prompt
          value={fill(t.overview.wirePrompt, {
            origin,
            name: sheet?.kind === 'wire' ? sheet.name : '',
            wire: sheet?.kind === 'wire' ? sheet.wire : 0,
            server: sheet?.kind === 'wire' ? sheet.server : 0,
          })}
        />
        <p className="caption">{t.overview.wireSheetTail}</p>
      </Dialog>
    </>
  );
}
