import type { AgentConnection } from '@dotx/shared/http/admin';
import { DataTable } from '../../../../components/ui/data-table.tsx';
import { EmptyState } from '../../../../components/ui/empty-state.tsx';
import { Pill } from '../../../../components/ui/pill.tsx';
import { dateTime, since, t } from '../../../../i18n/index.ts';
export function ConnectionList({
  agents,
  onAdd,
  onRename,
  onRemove,
}: {
  agents: AgentConnection[];
  onAdd: () => void;
  onRename: (agent: AgentConnection) => void;
  onRemove: (agent: AgentConnection) => void;
}) {
  return (
    <DataTable
      rows={agents}
      rowKey={(agent) => agent.agent_id}
      rowTitle={(agent) => agent.name}
      empty={
        <EmptyState
          title={t.agents.emptyTitle}
          description={t.agents.emptyBody}
          action={t.agents.add}
          onAction={onAdd}
        />
      }
      columns={[
        {
          key: 'name',
          label: t.agents.colName,
          cell: (agent) => (
            <>
              <span className="cell-name agent-name">{agent.name}</span>
              <span className="cell-sub mono">{agent.agent_id.slice(0, 8)}</span>
            </>
          ),
        },
        {
          key: 'status',
          label: t.agents.colStatus,
          cell: (agent) => <AgentStatus agent={agent} />,
        },
        {
          key: 'lastSeen',
          label: t.agents.colLastSeen,
          sort: (a, b) => (a.active?.last_seen ?? 0) - (b.active?.last_seen ?? 0),
          cell: (agent) => (
            <span
              className="num agent-time"
              title={agent.active ? dateTime(agent.active.last_seen) : undefined}
            >
              {agent.active ? since(agent.active.last_seen) : '—'}
            </span>
          ),
        },
        {
          key: 'created',
          label: t.agents.colCreated,
          sort: (a, b) => a.created_at - b.created_at,
          cell: (agent) => <span className="num agent-time">{dateTime(agent.created_at)}</span>,
        },
      ]}
      actions={(agent) => [
        {
          label: t.agents.rename,
          on: () => onRename(agent),
        },
        {
          label: t.agents.revoke,
          danger: true,
          on: () => onRemove(agent),
        },
      ]}
    />
  );
}
/** Approval becomes connected after the first authenticated MCP request. */
function AgentStatus({ agent }: { agent: AgentConnection }) {
  return (
    <Pill tone={agent.active ? 'live' : 'idle'}>
      {agent.active ? t.agents.statusConnected : t.agents.statusNotConnected}
    </Pill>
  );
}
