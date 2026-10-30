import type { AdminDevice } from '@dotx/shared/http/admin';
import { DataTable } from '../../../../components/ui/data-table.tsx';
import { EmptyState } from '../../../../components/ui/empty-state.tsx';
import { Pill } from '../../../../components/ui/pill.tsx';
import { dateTime, since, t } from '../../../../i18n/index.ts';
export function DeviceList({
  devices,
  onAdd,
  onFix,
  onRename,
  onRemove,
}: {
  devices: AdminDevice[];
  onAdd: () => void;
  onFix: (device: AdminDevice) => void;
  onRename: (device: AdminDevice) => void;
  onRemove: (device: AdminDevice) => void;
}) {
  return (
    <DataTable
      rows={devices}
      rowKey={(device) => device.device_id}
      empty={
        <EmptyState
          title={t.devices.emptyTitle}
          description={t.devices.emptyBody}
          action={t.devices.add}
          onAction={onAdd}
        />
      }
      columns={[
        {
          key: 'name',
          label: t.devices.colDevice,
          cell: (device) => (
            <>
              <span className="cell-name">{device.name}</span>
              <span className="cell-sub mono">{device.device_id.slice(0, 8)}</span>
            </>
          ),
        },
        {
          key: 'status',
          label: t.devices.colStatus,
          cell: (device) => <Status device={device} />,
        },
        {
          key: 'version',
          label: t.devices.colVersion,
          cell: (device) => (
            <span className="num">
              {device.desktop_version ?? '—'}
              {device.wire_protocol !== null && ` · w${device.wire_protocol}`}
            </span>
          ),
        },
        {
          key: 'seen',
          label: t.devices.colSeen,
          sort: (a, b) => (a.last_seen ?? 0) - (b.last_seen ?? 0),
          cell: (device) => (
            <span className="num" title={device.last_seen ? dateTime(device.last_seen) : undefined}>
              {device.last_seen ? since(device.last_seen) : t.common.never}
            </span>
          ),
        },
      ]}
      actions={(device) => [
        ...(device.compatible === false ||
        !device.online ||
        !device.interfaces.some((entry) => entry.availability === 'online')
          ? [
              {
                label: device.compatible === false ? t.devices.upgrade : t.devices.fix,
                on: () => onFix(device),
              },
            ]
          : []),
        {
          label: t.devices.rename,
          secondary: true,
          on: () => onRename(device),
        },
        {
          label: t.devices.remove,
          danger: true,
          secondary: true,
          on: () => onRemove(device),
        },
      ]}
    />
  );
}
/** Status is a state, not a menu: whatever can be done lives in Actions. */
function Status({ device }: { device: AdminDevice }) {
  if (device.compatible === false)
    return (
      <>
        <Pill tone="attn">{t.devices.statusIncompatible}</Pill>
        <span className="cell-sub">
          {t.devices.wireMismatch
            .replace('{wire}', String(device.wire_protocol ?? '?'))
            .replace('{server}', String(device.server_wire_protocol))}
        </span>
      </>
    );

  if (!device.online) return <Pill tone="idle">{t.devices.statusOffline}</Pill>;

  if (!device.interfaces.some((entry) => entry.availability === 'online'))
    return <Pill tone="attn">{t.devices.statusDegraded}</Pill>;

  return <Pill tone="live">{t.devices.statusOnline}</Pill>;
}
