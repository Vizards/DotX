import { WIRE_VERSION } from '@dotx/shared/gateway';
import { hub as selectHub, HUB_NAME } from '../src/hub/namespace.ts';
const namespace = {
  idFromName: (name: string) => ({ toString: () => name }),
} as unknown as DurableObjectNamespace;
import test from 'node:test';
import { MemoryStore } from './fixtures/store.ts';
import type { TestContext } from 'node:test';
import type { HubSocket, SocketInfo } from '../src/hub/device-hub.ts';
import type { DeviceList } from '@dotx/shared/protocol';
import type { z } from 'zod';
import { gatewayCommand } from '@dotx/shared/gateway';
type Command = z.infer<typeof gatewayCommand>;
interface TestSocket extends HubSocket {
  info: SocketInfo;
  sent: { type: string; id?: string }[];
  commandSent: Promise<Command>;
}
import assert from 'node:assert/strict';
import { DeviceHub } from '../src/hub/device-hub.ts';
test('hub uses one identity without placement options and rejects other identities', async () => {
  let selected: unknown[] = [];
  selectHub({
    DEVICES: {
      getByName: (...args: unknown[]) => {
        selected = args;
      },
    } as unknown as DurableObjectNamespace,
  });
  assert.deepEqual(selected, ['devices']);
  const make = (identity: string) =>
    new DeviceHub(
      {
        id: { toString: () => identity },
        storage: new MemoryStore(),
        getWebSockets: () => [],
        acceptWebSocket() {},
      },
      { DEVICES: namespace },
    );
  const hub = make(HUB_NAME);
  const response = await hub.fetch(
    new Request('https://hub/events', {
      method: 'POST',
      body: JSON.stringify({ method: 'status', auth: { principal: 'test', devices: [] } }),
    }),
  );
  const body = (await response.json()) as any;
  assert.equal(body.result.hub_jurisdiction, null);
  assert.equal(body.result.hub_location_hint, null);
  assert.equal(body.result.diagnostic_version, 1);
  assert.equal(body.result.retry_policy.max_retries, 9);
  assert.equal(body.result.callback_transport, 'direct');
  const old = make('retired-us-object');
  await assert.rejects(old.fetch(new Request('https://hub/devices')), /HUB_IDENTITY_MISMATCH/);
  await assert.rejects(old.alarm(), /HUB_IDENTITY_MISMATCH/);
});

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const sockets: TestSocket[] = [];
  const storage = new MemoryStore();
  storage.data.set('setup:devices', [
    { id: 'mini', label: 'mini' },
    { id: 'book', label: 'book' },
  ]);
  const hub = new DeviceHub(
    {
      id: { toString: () => HUB_NAME },
      storage,
      getWebSockets: (id) => sockets.filter((s) => s.info.deviceId === id),
      acceptWebSocket() {},
    },
    {
      DEVICES: namespace,
    },
  );
  function connect(deviceId: string, availability = 'online') {
    let dispatched!: (command: Command) => void;
    const commandSent = new Promise<Command>((resolve) => {
      dispatched = resolve;
    });
    const socket: TestSocket = {
      info: { deviceId, lastSeen: 0 },
      sent: [],
      serializeAttachment(info: SocketInfo) {
        this.info = info;
      },
      deserializeAttachment() {
        return this.info;
      },
      commandSent,
      send(data: string) {
        const msg = JSON.parse(data);
        this.sent.push(msg);
        if (msg.type === 'command') dispatched(msg);
      },
      close() {},
    };
    sockets.push(socket);
    hub.webSocketMessage(
      socket,
      JSON.stringify({
        type: 'heartbeat',
        protocol: WIRE_VERSION,
        availability,
        connectorVersion: 'test',
        interfaces: [{ name: 'app_tools', runtime_id: 'runtime-' + deviceId, availability }],
      }),
    );
    return socket;
  }
  const devices = async () =>
    (await (await hub.fetch(new Request('https://hub/devices'))).json<DeviceList>()).devices;
  const command = (deviceId: string, operation = 'call') =>
    hub.fetch(
      new Request('https://hub/command', {
        method: 'POST',
        body: JSON.stringify({
          operation,
          args: {
            connection_id: deviceId,
            interface: 'app_tools',
            runtime_id: 'runtime-' + deviceId,
          },
        }),
      }),
    );
  return { hub, connect, devices, command };
}
test('device offline, unavailable and recovered states stay independent', async (t) => {
  const f = fixture(t);
  const mini = f.connect('mini');
  const book = f.connect('book', 'unavailable');
  assert.deepEqual(
    (await f.devices()).map((x) => x.availability),
    ['online', 'unavailable'],
  );
  assert.equal(
    (await (await f.command('book')).json<{ error: { code: string } }>()).error.code,
    'INTERFACE_UNAVAILABLE',
  );
  f.hub.webSocketClose(book);
  assert.deepEqual(
    (await f.devices()).map((x) => x.availability),
    ['online', 'offline'],
  );
  assert.equal(
    (await (await f.command('book')).json<{ error: { code: string } }>()).error.code,
    'DEVICE_OFFLINE',
  );
  f.connect('book');
  assert.deepEqual(
    (await f.devices()).map((x) => x.availability),
    ['online', 'online'],
  );
  t.mock.timers.tick(45000);
  f.hub.webSocketMessage(
    mini,
    JSON.stringify({ type: 'heartbeat', protocol: WIRE_VERSION, availability: 'online' }),
  );
  assert.deepEqual(
    (await f.devices()).map((x) => x.availability),
    ['online', 'offline'],
  );
});
test('only selected instance can answer; response loss does not fail over or resend', async (t) => {
  const f = fixture(t);
  const first = f.connect('mini');
  t.mock.timers.tick(1);
  const selected = f.connect('mini');
  const pending = f.command('mini');
  const request = await selected.commandSent;
  f.hub.webSocketMessage(
    first,
    JSON.stringify({ type: 'response', id: request.id, ok: true, result: { wrong: true } }),
  );
  assert.equal(f.hub.pending.size, 1);
  f.hub.webSocketClose(selected);
  assert.equal(
    (await (await pending).json<{ error: { code: string } }>()).error.code,
    'CONNECTION_LOST_OUTCOME_UNKNOWN',
  );
  assert.equal(first.sent.filter((m) => m.type === 'command').length, 0);
  assert.equal(selected.sent.filter((m) => m.type === 'command').length, 1);
});
test('send timeout explicitly reports unknown without another dispatch', async (t) => {
  const f = fixture(t);
  const socket = f.connect('mini');
  const pending = f.command('mini');
  await socket.commandSent;
  t.mock.timers.tick(55000);
  assert.equal(
    (await (await pending).json<{ error: { code: string } }>()).error.code,
    'CALL_OUTCOME_UNKNOWN',
  );
  assert.equal(socket.sent.filter((m) => m.type === 'command').length, 1);
  assert.equal(f.hub.pending.size, 0);
});

test('native turn reads require a compatible connector; cloud receipts are not routed as desktop commands', async (t) => {
  const f = fixture(t);
  const socket = f.connect('book', 'unavailable');
  const pending = f.command('book', 'read_turn');
  const request = await socket.commandSent;
  assert.equal(request.operation, 'read_turn');
  f.hub.webSocketMessage(
    socket,
    JSON.stringify({ type: 'response', id: request.id, ok: true, result: { state: 'completed' } }),
  );
  assert.equal(
    (await (await pending).json<{ result: { state: string } }>()).result.state,
    'completed',
  );
  for (const op of ['call']) {
    const result = await (await f.command('book', op)).json<{ error: { code: string } }>();
    assert.equal(result.error.code, 'INTERFACE_UNAVAILABLE');
  }
  f.hub.webSocketMessage(
    socket,
    JSON.stringify({ type: 'heartbeat', protocol: 99, availability: 'online' }),
  );
  assert.equal(
    (await (await f.command('book', 'read_turn')).json<{ error: { code: string } }>()).error.code,
    'DEVICE_UNAVAILABLE',
  );
  t.mock.timers.tick(45000);
  assert.equal(
    (await (await f.command('book', 'read_turn')).json<{ error: { code: string } }>()).error.code,
    'DEVICE_OFFLINE',
  );
});

test('hibernated incompatible-protocol attachments cannot appear online or receive new commands', async (t) => {
  const f = fixture(t);
  const socket = f.connect('book');
  socket.info.protocol = WIRE_VERSION + 1;
  socket.info.availability = 'online';
  const book = (await f.devices())[1];
  assert.equal(book.availability, 'unavailable');
  assert.equal(book.diagnostic?.code, 'DEVICE_PROTOCOL_MISMATCH');
  assert.equal(
    (await (await f.command('book')).json<{ error: { code: string } }>()).error.code,
    'DEVICE_UNAVAILABLE',
  );
  assert.equal(socket.sent.filter((x) => x.type === 'command').length, 0);
});

test('event reads stay on the owning runtime and report expiration after it exits', async (t) => {
  const f = fixture(t);
  const owner = f.connect('book');
  t.mock.timers.tick(1);
  const newer = f.connect('book');
  newer.info.interfaces![0].runtime_id = 'another-runtime';
  const pending = f.command('book', 'read_events');
  const request = await owner.commandSent;
  assert.equal(newer.sent.filter((x) => x.type === 'command').length, 0);
  f.hub.webSocketMessage(
    owner,
    JSON.stringify({
      type: 'response',
      id: request.id,
      ok: true,
      result: { runtime_active: true },
    }),
  );
  assert.equal(
    (await (await pending).json<{ result: { runtime_active: boolean } }>()).result.runtime_active,
    true,
  );
  f.hub.webSocketClose(owner);
  const history = await (await f.command('book', 'read_events')).json<any>();
  assert.equal(history.error.code, 'RUNTIME_CHANGED');
  assert.equal(newer.sent.filter((x) => x.type === 'command').length, 0);
});

test('discovery keeps a healthy established instance despite newer transient heartbeats', async (t) => {
  const f = fixture(t);
  const established = f.connect('book');
  t.mock.timers.tick(1);
  const transient = f.connect('book');
  transient.info.interfaces![0].runtime_id = 'transient-runtime';
  assert.equal((await f.devices())[1].interfaces![0].runtime_id, 'runtime-book');
  const pending = f.command('book', 'describe_methods');
  const request = await established.commandSent;
  assert.equal(transient.sent.filter((x) => x.type === 'command').length, 0);
  f.hub.webSocketMessage(
    established,
    JSON.stringify({
      type: 'response',
      id: request.id,
      ok: true,
      result: { runtime_id: 'runtime-book' },
    }),
  );
  await pending;
  established.info.interfaces = [];
  assert.equal(f.hub.discoverySockets('book', 'app_tools')[0].socket, transient);
  f.hub.webSocketClose(established);
  assert.equal((await f.devices())[1].interfaces![0].runtime_id, 'transient-runtime');
});

test('DO chooses one observer per interface; restore commands contain no writes or prompts', async (t) => {
  const f = fixture(t);
  const first = f.connect('mini');
  t.mock.timers.tick(1);
  const second = f.connect('mini');
  second.info.interfaces![0].runtime_id = 'another';
  const task = {
    id: 'intent',
    request_id: 'request',
    connection_id: 'mini',
    hostId: 'local',
    threadId: 'target',
    turnId: null,
    state: 'unknown',
    startedAt: 1,
  };
  await f.hub.ctx.storage.put('state:call:intent', { id: 'intent', task });
  await f.hub.ctx.storage.put('state:active:mini:intent', 'intent');
  await f.hub.restoreDevice('mini');
  const restore = (socket: TestSocket) =>
    socket.sent.filter((m) => m.type === 'restore').at(-1) as any;
  assert.deepEqual(restore(first).tasks, [task]);
  assert.deepEqual(restore(second).tasks, []);
  assert(!JSON.stringify(restore(first)).includes('prompt'));
  f.hub.webSocketClose(first);
  await f.hub.restoreDevice('mini');
  assert.deepEqual(restore(second).tasks, [task]);
  assert.equal(second.sent.filter((m) => m.type === 'command').length, 0);
});
