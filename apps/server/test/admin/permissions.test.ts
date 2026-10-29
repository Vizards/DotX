import test from 'node:test';
import assert from 'node:assert/strict';
import { beginAuthorization } from '../support/oauth.ts';
import { startServer } from '../support/server.ts';

const editor = '55b7b7b20ad14560a58db0121f015c17';
const administrator = 'e99ac7f52b564790946ff5606061979d';
const ownerHeaders = { Authorization: 'Bearer synthetic-wrangler-oauth' };
function workerPolicy(permission: string, worker = 'test-worker', account = 'test-account') {
  return {
    access: 'allow',
    permission_groups: [{ id: permission }],
    resource_groups: [
      {
        scope: {
          key: 'com.cloudflare.edge.worker.script.' + worker,
          objects: [{ key: '*' }],
          subset_of: [{ key: 'com.cloudflare.api.account.' + account }],
        },
      },
    ],
  };
}

test('management APIs enforce target Worker authority before creating or approving anything', async (t) => {
  const api = await startServer(t);
  const policies = api.cloudflare.member.policies;
  const device = await api.enroll(false);
  const flow = await beginAuthorization(api.request);
  for (const candidate of [
    { headers: {}, policies, status: 401 },
    { headers: ownerHeaders, policies: [workerPolicy('synthetic-read-only')], status: 403 },
    { headers: ownerHeaders, policies: [workerPolicy(editor, 'other-worker')], status: 403 },
    {
      headers: ownerHeaders,
      policies: [workerPolicy(editor, 'test-worker', 'other-account')],
      status: 403,
    },
    {
      headers: ownerHeaders,
      policies: [workerPolicy(editor), { ...workerPolicy(administrator), access: 'deny' }],
      status: 403,
    },
  ]) {
    api.cloudflare.member.policies = candidate.policies;
    for (const [path, method, body] of [
      ['/admin/api/session', 'GET', undefined],
      [`/admin/api/agent-requests/${flow.transaction}/approve`, 'POST', '{}'],
      [`/admin/api/device-requests/${device.input.operation_id}/approve`, 'POST', undefined],
      [
        `/admin/api/devices/${device.input.device_id}`,
        'PATCH',
        JSON.stringify({ name: 'forbidden' }),
      ],
    ] as const) {
      const response = await api.request(path, { method, headers: candidate.headers, body });
      assert.equal(response.status, candidate.status, await response.clone().text());
      await response.text();
    }
  }
  api.cloudflare.member.policies = policies;
  assert.deepEqual((await api.admin('/agents')).agents, []);
  const pending = await api.admin('/device-requests');
  assert.equal(
    pending.requests.find((row: any) => row.operation_id === device.input.operation_id)?.status,
    'pending',
  );
  for (const role of [editor, administrator]) {
    api.cloudflare.member.policies = [workerPolicy(role)];
    const allowed = await beginAuthorization(api.request);
    const created = await api.admin(`/agent-requests/${allowed.transaction}/approve`, 'POST', {});
    assert(created.agent_id);
    const revokedAgent = await api.admin(`/agents/${created.agent_id}/revoke`, 'POST');
    assert.equal(revokedAgent.revoked, true);
    assert.equal(revokedAgent.pending, null);
    const approved = await api.enroll(false);
    const result = await api.admin(
      `/device-requests/${approved.input.operation_id}/approve`,
      'POST',
    );
    assert.equal(result.status, 'approved');
    const revokedDevice = await api.admin(`/devices/${approved.input.device_id}/revoke`, 'POST');
    assert.equal(revokedDevice.status, 'revoked');
  }
});

test('management requests stop membership pagination at the target and recheck Wrangler authority', async (t) => {
  const api = await startServer(t, 'paginated');
  await api.admin('/session');
  assert.deepEqual(
    api.cloudflare.calls
      .filter((call) => call.url.pathname === '/client/v4/memberships')
      .map((call) => call.url.searchParams.get('page')),
    ['1', '2'],
  );
  api.cloudflare.membershipResponse = 'detail';
  await api.admin('/session');
  assert(
    api.cloudflare.calls.some((call) => call.url.pathname === '/client/v4/memberships/test-member'),
  );
  api.cloudflare.member.policies = [workerPolicy('synthetic-read-only')];
  const denied = await api.request('/admin/api/agents', {
    headers: ownerHeaders,
  });
  assert.equal(denied.status, 403);
  await denied.text();
  api.cloudflare.member.policies = [workerPolicy(editor)];
  assert.deepEqual((await api.admin('/agents')).agents, []);
});
