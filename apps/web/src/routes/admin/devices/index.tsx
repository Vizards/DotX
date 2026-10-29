import { DeviceList } from './-components/device-list.tsx';
import { NameDialog } from '../../../components/ui/name-dialog.tsx';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdminDevice, DeviceRequest } from '@dotx/shared/http/admin';
import { applicationLabel } from '@dotx/shared/http/enrollment';
import { sessionQuery } from '../../../queries/session.ts';
import { devicesQuery, requestsQuery } from '../../../queries/devices.ts';
import {
  decideRequestMutation,
  renameDeviceMutation,
  revokeDeviceMutation,
} from '../../../mutations/devices.ts';
import { Alert, Loading } from '../../../components/ui/feedback.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Dialog } from '../../../components/ui/dialog.tsx';
import { FixDeviceDialog } from './-components/fix-device-dialog.tsx';
import { useConfirm } from '../../../components/confirm-context.ts';
import { useNow } from '../../../hooks/use-now.ts';
import { useRefresh } from '../../../hooks/use-refresh.ts';
import { NewDeviceDialog } from '../../../components/new-device.tsx';
import { fill, since, t } from '../../../i18n/index.ts';

export const Route = createFileRoute('/admin/devices/')({
  validateSearch: (search: Record<string, unknown>) => ({
    operation_id: typeof search.operation_id === 'string' ? search.operation_id : undefined,
  }),
  component: Devices,
});

function Devices() {
  const session = useQuery(sessionQuery());
  const devices = useQuery(devicesQuery());
  const requests = useQuery(requestsQuery());
  const search = Route.useSearch();
  const csrf = session.data?.authenticated ? session.data.csrf_token! : '';
  const origin = session.data?.authenticated ? session.data.service.origin : window.location.origin;

  const decide = useMutation(decideRequestMutation(csrf));
  const revoke = useMutation(revokeDeviceMutation(csrf));
  const rename = useMutation(renameDeviceMutation(csrf));

  const [connecting, setConnecting] = useState(false);
  const [editing, setEditing] = useState<AdminDevice | null>(null);
  const [removing, setRemoving] = useState<AdminDevice | null>(null);
  // The fix for a broken device has to be carried to that Mac by hand, so each
  // one opens a prompt instead of a document.
  const [fixing, setFixing] = useState<AdminDevice | null>(null);
  const confirm = useConfirm();

  const busy = decide.isPending || revoke.isPending || rename.isPending;
  const reload = () => Promise.all([devices.refetch(), requests.refetch()]);
  const refresh = useRefresh(reload);

  const approved = (devices.data?.devices ?? []).filter((d) => d.status === 'approved');
  // An expired request is not a decision the user can still make, so it is not
  // shown at all; the Mac simply submits a new one.
  const now = useNow();
  const pending = (requests.error ? [] : (requests.data?.requests ?? []))
    .filter((r) => r.status === 'pending' && r.expires_at > now)
    .sort(
      (a, b) =>
        Number(b.operation_id === search.operation_id) -
        Number(a.operation_id === search.operation_id),
    );
  const selected = requests.data?.requests.find((r) => r.operation_id === search.operation_id);
  const selectedStatus =
    selected?.status === 'pending' && selected.expires_at <= now ? 'expired' : selected?.status;
  const online = approved.filter((d) => d.online).length;

  const decideRequest = async (request: DeviceRequest, decision: 'approve' | 'reject') => {
    if (decision === 'reject') {
      await confirm({
        title: t.devices.rejectTitle,
        body: fill(t.devices.rejectBody, {
          name: request.name,
          label: applicationLabel(request.operation_id),
        }),
        confirm: t.devices.reject,
        danger: true,
        onConfirm: () => decide.mutateAsync({ id: request.operation_id, decision }),
      });
      return;
    }
    decide.mutate({ id: request.operation_id, decision });
  };

  return (
    <>
      <div className="page-head">
        <h1>{t.devices.title}</h1>
        <div className="stat-row">
          <div className="stat">
            <b>{devices.error ? 'N/A' : devices.data ? approved.length : '—'}</b>
            <span>{t.overview.statApproved}</span>
          </div>
          <div className="stat">
            <b>{devices.error ? 'N/A' : devices.data ? online : '—'}</b>
            <span>{t.overview.statOnline}</span>
          </div>
          <div className="stat" data-tone={pending.length ? 'attn' : undefined}>
            <b>{requests.error ? 'N/A' : requests.data ? pending.length : '—'}</b>
            <span>{t.devices.statAwaiting}</span>
          </div>
        </div>
      </div>

      {requests.error && (
        <section className="table-card">
          <div className="table-head">
            <h2>{t.authorize.pendingTitle}</h2>
          </div>
          <div className="table-feedback">
            <Alert error={requests.error} retry={() => void requests.refetch()} />
          </div>
        </section>
      )}

      {search.operation_id && requests.data && !requests.error && selectedStatus !== 'pending' && (
        <div className="notice" role="status">
          {selected && selectedStatus ? (
            <span>
              <span className="mono">{applicationLabel(selected.operation_id)}</span>
              {' · '}
              {t.devices.requestStatus[selectedStatus]}
            </span>
          ) : (
            t.devices.requestUnavailable
          )}
        </div>
      )}

      {pending.map((request) => {
        // Calm until the last hour: before that the dot would pulse for no reason.
        const soon = request.expires_at - now < 3600_000;
        return (
          <div
            className="notice"
            data-tone="attn"
            data-selected={request.operation_id === search.operation_id || undefined}
            key={request.operation_id}
          >
            <div className="grow">
              <div className="request-heading">
                <p className="title">{request.name}</p>
                <span className="codechip mono" title={t.devices.verificationLabel}>
                  {applicationLabel(request.operation_id)}
                </span>
              </div>
              <div className="meta">
                <span className={`countdown${soon ? ' countdown--soon' : ''}`}>
                  <i className="dot" aria-hidden="true" />
                  {t.devices.pendingExpires.replace('{time}', since(request.expires_at, now))}
                </span>
              </div>
              {decide.variables?.id === request.operation_id &&
                decide.variables.decision === 'approve' && <Alert error={decide.error} />}
            </div>
            <div className="ops">
              <Button
                variant="solid"
                small
                disabled={busy}
                onClick={() => {
                  void decideRequest(request, 'approve');
                }}
              >
                {t.devices.approve}
              </Button>
              <Button
                small
                disabled={busy}
                onClick={() => {
                  void decideRequest(request, 'reject');
                }}
              >
                {t.devices.reject}
              </Button>
            </div>
          </div>
        );
      })}

      <div className="table-card">
        <div className="table-head">
          <h2>{t.devices.listTitle}</h2>
          <div className="meta">
            {(devices.data || devices.error) && (
              <span>
                {t.devices.listCount.replace(
                  '{n}',
                  devices.error ? 'N/A' : String(approved.length),
                )}
              </span>
            )}
            <Button small disabled={refresh.busy} busy={refresh.busy} onClick={refresh.start}>
              {t.common.refresh}
            </Button>
          </div>
        </div>

        {devices.isPending ? (
          <Loading />
        ) : devices.error ? (
          <div className="table-feedback">
            <Alert error={devices.error} />
          </div>
        ) : (
          <DeviceList
            devices={approved}
            onAdd={() => setConnecting(true)}
            onFix={setFixing}
            onRename={(device) => {
              rename.reset();
              setEditing(device);
            }}
            onRemove={(device) => {
              revoke.reset();
              setRemoving(device);
            }}
          />
        )}
      </div>

      <NewDeviceDialog open={connecting} origin={origin} onClose={() => setConnecting(false)} />

      {fixing && (
        <FixDeviceDialog device={fixing} origin={origin} onClose={() => setFixing(null)} />
      )}

      {editing && (
        <NameDialog
          key={editing.device_id}
          title={t.devices.renameTitle}
          label={t.devices.renameLabel}
          initialValue={editing.name}
          submitLabel={t.devices.saveName}
          busy={busy}
          error={rename.error}
          onClose={() => setEditing(null)}
          onSave={(name) => rename.mutateAsync({ id: editing.device_id, name })}
        />
      )}

      <Dialog
        open={removing !== null}
        title={t.devices.removeTitle.replace('{name}', removing?.name ?? '')}
        showClose={false}
        onClose={() => setRemoving(null)}
      >
        <p>{t.devices.removeBody}</p>
        <Alert error={revoke.error} />
        <div className="acts">
          <Button onClick={() => setRemoving(null)}>{t.common.cancel}</Button>
          <Button
            variant="solid-danger"
            disabled={busy}
            onClick={() => {
              if (!removing) return;
              revoke.mutate(removing.device_id, {
                onSuccess: () => setRemoving(null),
              });
            }}
          >
            {t.devices.removeConfirm}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
