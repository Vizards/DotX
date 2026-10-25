import { useMemo } from 'react';
import type { AgentConnection } from '@dotx/shared/http/admin';
import { DataTable, type Column } from '../../-table.tsx';
export type AgentAction = 'rename' | 'reissue' | 'cancel' | 'revoke';
export function ConnectionList({
  agents,
  busy,
  action,
}: {
  agents: AgentConnection[];
  busy: boolean;
  action: (kind: AgentAction, agent: AgentConnection) => void;
}) {
  const columns = useMemo<Column<AgentConnection>[]>(
    () => [
      { accessorKey: 'name', header: 'Name' },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (a) =>
          a.revoked
            ? 'Revoked'
            : [
                a.active ? 'Connected' : '',
                a.pending
                  ? {
                      waiting_code: 'Waiting for code',
                      authorizing: 'Authorizing',
                      waiting_connection: 'Waiting for first connection',
                    }[a.pending.phase]
                  : !a.active
                    ? 'Not connected'
                    : '',
              ]
                .filter(Boolean)
                .join(' · '),
      },
      {
        id: 'actions',
        header: 'Manage',
        cell: ({ row }) => (
          <>
            <button disabled={busy} onClick={() => action('rename', row.original)}>
              Rename
            </button>
            <button disabled={busy} onClick={() => action('reissue', row.original)}>
              Reissue code
            </button>
            {row.original.pending?.phase === 'waiting_code' && (
              <button disabled={busy} onClick={() => action('cancel', row.original)}>
                Cancel unused code
              </button>
            )}
            {!row.original.revoked && (
              <button disabled={busy} onClick={() => action('revoke', row.original)}>
                Revoke
              </button>
            )}
          </>
        ),
      },
    ],
    [busy, action],
  );
  return agents.length ? (
    <DataTable data={agents} columns={columns} />
  ) : (
    <p>No Personal Agent connections yet.</p>
  );
}
