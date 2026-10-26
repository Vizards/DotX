import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import { startServer, toolData } from '../support/server.ts';

test('management device status reports the current connector or its last protocol diagnostic', async (t) => {
  const api = await startServer(t);
  const device = await api.enroll();
  const status = async () => (await api.admin('/devices')).devices[0];
  let row = await status();
  assert.equal(row.wire_protocol, null);
  assert.equal(row.compatible, null);
  assert.equal(row.online, false);

  await api.connect(device, { generation: 10, wire: WIRE_VERSION + 1, version: '0.2.0' });
  row = await status();
  assert.equal(row.wire_protocol, WIRE_VERSION + 1);
  assert.equal(row.compatible, false);
  assert.equal(row.online, false);
  assert.equal(row.desktop_version, '0.2.0');
  assert.equal(row.diagnostic.code, 'DEVICE_PROTOCOL_MISMATCH');

  await api.connect(device, { generation: 1, version: '0.1.0' });
  row = await status();
  assert.equal(row.wire_protocol, WIRE_VERSION);
  assert.equal(row.compatible, true);
  assert.equal(row.desktop_version, '0.1.0');
  assert.equal(row.diagnostic, null);

  await api.connect(device, { generation: 11, wire: WIRE_VERSION + 1, version: '0.2.0' });
  row = await status();
  assert.equal(row.wire_protocol, WIRE_VERSION);
  assert.equal(row.compatible, true);
  assert.equal(row.desktop_version, '0.1.0');
  assert.equal(row.diagnostic, null);
});

test('renaming a device changes its visible label without changing its identity or enrollment', async (t) => {
  const api = await startServer(t);
  const device = await api.enroll(true, 'Original Mac');
  const token = await api.authorize();
  const { socket } = await api.connect(device);
  const path = `/devices/${device.input.device_id}`;
  const before = (await api.admin('/devices')).devices[0];
  const renamed = await api.admin(path, 'PATCH', { name: 'MacBook' });
  assert.equal(renamed.name, 'MacBook');
  for (const field of ['device_id', 'key_id', 'public_key', 'status', 'approved_at', 'online'])
    assert.deepEqual(renamed[field], before[field]);
  assert.equal(socket.readyState, 1);
  const connections = () =>
    api.tool(token, 'list_connections').then((r) => toolData(r.result).connections);
  assert.equal((await connections())[0].label, 'MacBook');
  const enrollAgain = (input: typeof device.input) =>
    api.request('/setup/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  assert.equal((await enrollAgain(device.input)).status, 200);
  assert.equal((await api.admin('/device-requests')).requests[0].name, 'Original Mac');

  await api.admin(path + '/revoke', 'POST');
  assert.equal((await enrollAgain(device.input)).status, 200);
  const reapply = { ...device.input, operation_id: randomUUID() };
  assert.equal((await enrollAgain(reapply)).status, 200);
  await api.admin(`/device-requests/${reapply.operation_id}/approve`, 'POST');
  await api.connect(device, { generation: 2 });
  assert.equal((await connections())[0].label, 'MacBook');
  assert.equal((await api.admin('/devices')).devices[0].key_id, before.key_id);
});
