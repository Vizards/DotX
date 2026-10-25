import type { DeviceRequest } from '@dotx/shared/http/admin';
export function EnrollmentList({
  requests,
  busy,
  decide,
}: {
  requests: DeviceRequest[];
  busy: boolean;
  decide: (id: string, decision: 'approve' | 'reject') => void;
}) {
  const pending = requests.filter((r) => r.status === 'pending');
  return (
    <section>
      <h2>Waiting for approval</h2>
      {pending.length === 0 ? (
        <p>No pending requests.</p>
      ) : (
        pending.map((r) => (
          <section className="panel" key={r.operation_id}>
            <strong>{r.name}</strong>
            <p>
              Match this application with the local installation: <code>{r.operation_id}</code>
            </p>
            <button disabled={busy} onClick={() => decide(r.operation_id, 'approve')}>
              Approve
            </button>{' '}
            <button disabled={busy} onClick={() => decide(r.operation_id, 'reject')}>
              Reject
            </button>
          </section>
        ))
      )}
    </section>
  );
}
