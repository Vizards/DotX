import { useMemo } from 'react';
import type { AdminDevice } from '@dotx/shared/http/admin';
import { DataTable, type Column } from '../../-table.tsx';
export function DeviceList({
  devices,
  busy,
  revoke,
  rename,
}: {
  devices: AdminDevice[];
  busy: boolean;
  revoke: (device: AdminDevice) => void;
  rename: (device: AdminDevice) => void;
}) {
  const columns = useMemo<Column<AdminDevice>[]>(
    () => [
      { accessorKey: 'name', header: 'Name' },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (d) =>
          d.status === 'revoked'
            ? 'Revoked'
            : d.compatible === false
              ? 'Protocol incompatible'
              : !d.online
                ? 'Approved · Offline'
                : d.interfaces.some((i) => i.availability === 'online')
                  ? 'Online · Available'
                  : 'Online · Interfaces unavailable',
      },
      {
        id: 'actions',
        header: 'Manage',
        cell: ({ row }) => (
          <>
            <button disabled={busy} onClick={() => rename(row.original)}>
              Rename
            </button>{' '}
            {row.original.status !== 'revoked' && (
              <button disabled={busy} onClick={() => revoke(row.original)}>
                Remove
              </button>
            )}
          </>
        ),
      },
    ],
    [busy, revoke, rename],
  );
  return devices.length ? (
    <DataTable data={devices} columns={columns} />
  ) : (
    <p>No approved Codex devices yet.</p>
  );
}
