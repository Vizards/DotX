import test from 'node:test';
import assert from 'node:assert/strict';
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import { startServer } from '../support/server.ts';

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
