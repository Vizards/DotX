import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../support/server.ts';
import { beginAuthorization } from '../support/oauth.ts';

test('connections are created by approval only; duplicate client names never select a connection', async (t) => {
  const api = await startServer(t);
  const a = await beginAuthorization(api.request),
    b = await beginAuthorization(api.request);
  assert.equal((await api.admin('/agent-requests')).requests.length, 2);
  assert.equal((await api.admin('/agents')).agents.length, 0);
  // Retired clients must not silently turn a replacement request into a new connection.
  const invalid = await api.request(`/admin/api/agent-requests/${a.transaction}/approve`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer synthetic-wrangler-oauth',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ agent_id: 'unused-target' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await api.admin('/agents')).agents.length, 0);
  const first = await api.admin(`/agent-requests/${a.transaction}/approve`, 'POST', {
    name: '  My Personal Agent  ',
  });
  const second = await api.admin(`/agent-requests/${b.transaction}/approve`, 'POST', {
    name: '  ',
  });
  assert.notEqual(first.agent_id, second.agent_id);
  const agents = (await api.admin('/agents')).agents;
  assert.equal(
    agents.find((item: any) => item.agent_id === first.agent_id).name,
    'My Personal Agent',
  );
  assert.equal(
    agents.find((item: any) => item.agent_id === second.agent_id).name,
    second.client_name,
  );
  assert.equal(first.client_name, second.client_name);
  assert.equal(
    (await api.admin(`/agent-requests/${a.transaction}`)).client_name,
    first.client_name,
  );
  const duplicate = await api.request(`/admin/api/agent-requests/${a.transaction}/approve`, {
    method: 'POST',
    headers: { Authorization: 'Bearer synthetic-wrangler-oauth' },
    body: '{}',
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await api.admin('/agents')).agents.length, 2);
  await api.admin(`/agents/${first.agent_id}`, 'PATCH', { name: 'Renamed' });
  assert((await api.admin('/agents')).agents.some((item: any) => item.name === 'Renamed'));
  await api.admin(`/agents/${first.agent_id}/revoke`, 'POST');
  assert.equal((await a.finish(true)).status, 409);
  assert.equal((await b.finish(true)).status, 200);
});

test('cancelling a new approved request leaves other connections untouched', async (t) => {
  const api = await startServer(t);
  const current = await api.authorizeSession();
  await api.rpc(current.token, 'tools/list');
  const flow = await beginAuthorization(api.request);
  const next = await api.admin(`/agent-requests/${flow.transaction}/approve`, 'POST', {});
  const response = await api.request('/authorize', {
    method: 'POST',
    headers: flow.headers,
    body: flow.form('deny'),
  });
  assert.equal(response.status, 303);
  assert((await api.rpc(current.token, 'tools/list')).result.tools.length > 0);
  const cancelled = (await api.admin('/agents')).agents.find(
    (a: any) => a.agent_id === next.agent_id,
  );
  assert.equal(cancelled.pending, null);
  assert.equal(cancelled.active, null);
  assert.equal((await flow.finish(true)).status, 409);
});
