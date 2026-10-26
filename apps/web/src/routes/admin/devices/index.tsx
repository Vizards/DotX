import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdminDevice } from '@dotx/shared/http/admin';
import { sessionQuery } from '../../../queries/session.ts';
import { devicesQuery, requestsQuery } from '../../../queries/devices.ts';
import {
  decideRequestMutation,
  revokeDeviceMutation,
  renameDeviceMutation,
} from '../../../mutations/devices.ts';
import { DeviceList } from './-components/device-list.tsx';
import { EnrollmentList } from './-components/enrollment-list.tsx';
import { RenameForm } from './-components/rename-form.tsx';
import { Feedback, Loading } from '../../../components/feedback.tsx';
import { Guide } from '../../../components/layout.tsx';
export const Route = createFileRoute('/admin/devices/')({ component: Devices });
function Devices() {
  const session = useQuery(sessionQuery());
  const devices = useQuery(devicesQuery());
  const requests = useQuery(requestsQuery());
  const csrf = session.data?.authenticated ? session.data.csrf_token! : '';
  const decide = useMutation(decideRequestMutation(csrf));
  const revoke = useMutation(revokeDeviceMutation(csrf));
  const rename = useMutation(renameDeviceMutation(csrf));
  const [editing, setEditing] = useState<AdminDevice | null>(null);
  const busy = decide.isPending || revoke.isPending || rename.isPending;
  const refresh = () => {
    void devices.refetch();
    void requests.refetch();
  };
  return (
    <>
      <h1>Codex devices</h1>
      <p>
        <Guide path="codex/connect.md">Connect a Codex</Guide> ·{' '}
        <Guide path="troubleshooting/index.md">Troubleshoot</Guide> ·{' '}
        <Guide path="maintenance/update.md">Update</Guide>
      </p>
      <button onClick={refresh} disabled={devices.isFetching || requests.isFetching}>
        Refresh
      </button>
      <Feedback
        error={decide.error ?? revoke.error ?? rename.error ?? devices.error ?? requests.error}
        retry={refresh}
      />
      {editing && (
        <section className="panel">
          <h2>Rename {editing.name}</h2>
          <RenameForm
            key={editing.device_id}
            initial={editing.name}
            busy={busy}
            submit={async (name) => {
              try {
                await rename.mutateAsync({ id: editing.device_id, name });
                setEditing(null);
              } catch {
                /* Mutation error is rendered above. */
              }
            }}
            cancel={() => setEditing(null)}
          />
        </section>
      )}
      {requests.isPending ? (
        <Loading />
      ) : (
        requests.data && (
          <EnrollmentList
            requests={requests.data.requests}
            busy={busy}
            decide={(id, decision) => {
              if (decision === 'approve' || window.confirm('Reject this application?'))
                decide.mutate({ id, decision });
            }}
          />
        )
      )}
      {devices.isPending ? (
        <Loading />
      ) : (
        devices.data && (
          <DeviceList
            devices={devices.data.devices}
            busy={busy}
            rename={setEditing}
            revoke={(d) => {
              if (
                window.confirm(
                  `Revoke ${d.name} from this Server? This does not uninstall its plugin or stop native tasks.`,
                )
              )
                revoke.mutate(d.device_id);
            }}
          />
        )
      )}
      <p>Use available devices from your Personal Agent.</p>
    </>
  );
}
