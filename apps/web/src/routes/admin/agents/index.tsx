import { ConnectionList } from './-components/connection-list.tsx';
import { NameDialog } from '../../../components/ui/name-dialog.tsx';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AgentConnection } from '@dotx/shared/http/admin';
import { sessionQuery } from '../../../queries/session.ts';
import { authorizationRequestsQuery } from '../../../queries/authorization.ts';
import { agentsQuery } from '../../../queries/agents.ts';
import { renameAgentMutation, revokeAgentMutation } from '../../../mutations/agents.ts';
import { Alert, Loading } from '../../../components/ui/feedback.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { DataTable } from '../../../components/ui/data-table.tsx';
import { Dialog } from '../../../components/ui/dialog.tsx';
import { NewAgentDialog } from '../../../components/new-agent.tsx';
import { RequestDialog } from './-components/request-dialog.tsx';
import { useRefresh } from '../../../hooks/use-refresh.ts';
import { dateTime, t } from '../../../i18n/index.ts';

export const Route = createFileRoute('/admin/agents/')({
  validateSearch: (search: Record<string, unknown>) => ({
    request: typeof search.request === 'string' ? search.request : undefined,
  }),
  component: Agents,
});

function Agents() {
  const session = useQuery(sessionQuery());
  const list = useQuery(agentsQuery());
  const requests = useQuery(authorizationRequestsQuery());
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const closeReview = () => {
    setReviewing(null);
    void navigate({ search: { request: undefined }, replace: true });
  };
  const csrf = session.data?.authenticated ? session.data.csrf_token! : '';
  const service = session.data?.authenticated ? session.data.service : undefined;

  const rename = useMutation(renameAgentMutation(csrf));
  const revoke = useMutation(revokeAgentMutation(csrf));

  const refresh = useRefresh(async () => {
    await Promise.all([list.refetch(), requests.refetch()]);
  });
  const [connecting, setConnecting] = useState(false);
  const [editing, setEditing] = useState<AgentConnection | null>(null);
  const [revoking, setRevoking] = useState<AgentConnection | null>(null);

  const busy = [rename, revoke].some((m) => m.isPending);

  const agents = (list.data?.agents ?? []).filter((agent) => !agent.revoked);

  return (
    <>
      <div className="page-head">
        <h1>{t.agents.title}</h1>
        <div className="stat-row">
          <div className="stat">
            <b>{list.error ? 'N/A' : list.data ? agents.length : '—'}</b>
            <span>{t.agents.listTitle}</span>
          </div>
        </div>
      </div>

      {(requests.error || Boolean(requests.data?.requests.length)) && (
        <section className="table-card">
          <div className="table-head">
            <h2>{t.authorize.pendingTitle}</h2>
          </div>
          {requests.error ? (
            <div className="table-feedback">
              <Alert error={requests.error} retry={() => void requests.refetch()} />
            </div>
          ) : (
            <DataTable
              rows={requests.data!.requests}
              rowKey={(item) => item.transaction}
              rowTitle={(item) => item.client_name}
              columns={[
                {
                  key: 'client',
                  label: t.agents.colName,
                  cell: (item) => (
                    <>
                      <span className="cell-name">{item.client_name}</span>
                      <span className="cell-sub mono">{item.transaction.slice(0, 8)}</span>
                    </>
                  ),
                },
                {
                  key: 'callback',
                  label: t.authorize.callback,
                  cell: (item) => (
                    <span className="mono">
                      {new URL(item.redirect_uri).host || item.redirect_uri}
                    </span>
                  ),
                },
                {
                  key: 'created',
                  label: t.authorize.created,
                  cell: (item) => (
                    <span className="num agent-time">{dateTime(item.created_at)}</span>
                  ),
                },
              ]}
              actions={(item) => [
                { label: t.authorize.review, on: () => setReviewing(item.transaction) },
              ]}
            />
          )}
        </section>
      )}
      {service && (
        <RequestDialog
          id={reviewing ?? search.request ?? null}
          csrf={csrf}
          service={service}
          onClose={closeReview}
        />
      )}

      <section className="table-card">
        <div className="table-head">
          <h2>{t.agents.listTitle}</h2>
          <div className="meta">
            {(list.data || list.error) && (
              <span>
                {t.agents.listCount.replace('{n}', list.error ? 'N/A' : String(agents.length))}
              </span>
            )}
            <Button small disabled={refresh.busy} busy={refresh.busy} onClick={refresh.start}>
              {t.common.refresh}
            </Button>
            <Button
              small
              variant="solid"
              onClick={() => {
                setConnecting(true);
              }}
            >
              {t.agents.add}
            </Button>
          </div>
        </div>
        {list.isPending ? (
          <Loading />
        ) : list.error ? (
          <div className="table-feedback">
            <Alert error={list.error} />
          </div>
        ) : !list.error && list.data ? (
          <ConnectionList
            agents={agents}
            onAdd={() => setConnecting(true)}
            onRename={(agent) => {
              rename.reset();
              setEditing(agent);
            }}
            onRemove={(agent) => {
              revoke.reset();
              setRevoking(agent);
            }}
          />
        ) : null}
      </section>

      {editing && (
        <NameDialog
          key={editing.agent_id}
          title={t.agents.renameTitle}
          label={t.agents.nameLabel}
          initialValue={editing.name}
          submitLabel={t.forms.save}
          busy={busy}
          error={rename.error}
          onClose={() => setEditing(null)}
          onSave={(name) => rename.mutateAsync({ id: editing.agent_id, name })}
        />
      )}

      {service && (
        <NewAgentDialog
          open={connecting}
          title={t.agents.newTitle}
          service={service}
          onClose={() => setConnecting(false)}
        />
      )}

      <Dialog
        open={revoking !== null}
        title={t.agents.revokeTitle.replace('{name}', revoking?.name ?? '')}
        showClose={false}
        onClose={() => setRevoking(null)}
      >
        <p>{t.agents.revokeBody}</p>
        <Alert error={revoke.error} />
        <div className="acts">
          <Button onClick={() => setRevoking(null)}>{t.common.cancel}</Button>
          <Button
            variant="solid-danger"
            disabled={busy}
            onClick={() => {
              if (!revoking) return;
              revoke.mutate(revoking.agent_id, {
                onSuccess: () => setRevoking(null),
              });
            }}
          >
            {t.agents.revokeConfirm}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
