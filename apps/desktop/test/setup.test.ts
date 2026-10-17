import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SetupState, serviceOrigin } from '../src/setup/state.ts';
import { resolveService } from '../src/setup/discovery.ts';

test('account discovery joins the same service without plugin bindings or a supplied URL', async () => {
  const service = {
    product: 'dotx',
    setup_protocol: 1,
    origin: 'https://test.example.com',
  };
  let reads = 0;
  const read = async (origin: string) => {
    assert.equal(origin, service.origin);
    reads++;
    return service;
  };
  assert.deepEqual(await resolveService({ discovery: service }, read), service);
  assert.equal(reads, 1);
  await assert.rejects(resolveService({}, read), /SERVICE_DISCOVERY_REQUIRED/);
  await assert.rejects(resolveService({ discovery: { ...service, setup_protocol: 2 } }, read));
  await assert.rejects(
    resolveService({ discovery: service, savedOrigin: 'https://another.example.com' }, read),
    /SERVICE_IDENTITY_CHANGED/,
  );
  assert.equal(reads, 1, 'invalid discovery must not contact any service');
  await assert.rejects(
    resolveService({ discovery: service }, async () => ({
      ...service,
      origin: 'https://another.example.com',
    })),
    /SERVICE_ORIGIN_MISMATCH/,
  );
  await assert.rejects(
    resolveService({ discovery: service }, async () => {
      throw new Error('OFFLINE');
    }),
    /OFFLINE/,
  );
});

test('service selection works before creating a Remote connection', async () => {
  const service = {
    product: 'dotx',
    setup_protocol: 1,
    origin: 'https://test.example.com',
  };
  assert.deepEqual(await resolveService({ url: service.origin }, async () => service), service);
});

test('setup preserves only service association, pairing identity and private credentials', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotx-setup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = new SetupState(dir),
    token = state.secret('device-token');
  state.save({ origin: 'https://test.example.com', enrollmentId: 'pending' });
  const resumed = new SetupState(dir);
  assert.deepEqual(resumed.value, state.value);
  assert.equal(resumed.secret('device-token'), token);
  assert(!fs.readFileSync(resumed.file, 'utf8').includes(token));
  assert.equal(fs.statSync(path.join(resumed.dir, 'device-token')).mode & 0o777, 0o600);
  assert.throws(() => resumed.ownerKey(), /OWNER_CREDENTIAL_NOT_ON_THIS_MAC/);
  const unlock = state.lock();
  assert.throws(() => resumed.lock(), /SETUP_ALREADY_RUNNING/);
  unlock();
  resumed.lock()();
});
test('joining accepts only a service origin or MCP URL without embedded credentials', () => {
  assert.equal(serviceOrigin('https://test.example.com/mcp'), 'https://test.example.com');
  for (const url of [
    'http://test.example.com',
    'https://owner:secret@test.example.com',
    'https://test.example.com/?key=secret',
    'https://test.example.com/path',
  ])
    assert.throws(() => serviceOrigin(url));
});
