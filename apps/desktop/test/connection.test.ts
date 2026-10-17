import { WIRE_VERSION } from '@dotx/shared/gateway';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { Diagnostic } from '@dotx/shared/protocol';
import type { ConnectionCredentials } from '../src/runtime/config.ts';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DeviceConnection } from '../src/relay/connection.ts';

function fixture(t: TestContext, execute: () => Promise<unknown> = async () => ({})) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100000 });
  const sockets: Socket[] = [],
    diagnostics: (Diagnostic | null)[] = [];
  let credentials: ConnectionCredentials | Error | null = {
      relayUrl: 'https://relay.example',
      deviceToken: 'synthetic-token',
    },
    reads = 0;
  class Socket extends EventEmitter {
    readyState: number;
    sent: { type: string }[];
    constructor() {
      super();
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    open() {
      this.readyState = 1;
      this.emit('open');
    }
    send(value: string) {
      this.sent.push(JSON.parse(value));
    }
    receive(msg: unknown) {
      this.emit('message', JSON.stringify(msg));
    }
    terminate() {
      this.readyState = 3;
      this.emit('close');
    }
  }
  const connection = new DeviceConnection({
    deviceId: 'device-test',
    Socket,
    execute,
    heartbeat: () => ({ availability: 'online' }),
    diagnostic: (d) => diagnostics.push(d),
    credentials: () => {
      reads++;
      if (credentials instanceof Error) throw credentials;
      return credentials;
    },
  });
  t.after(() => connection.stop());
  return {
    connection,
    sockets,
    diagnostics,
    setCredentials: (value: ConnectionCredentials | Error | null) => {
      credentials = value;
    },
    reads: () => reads,
  };
}
test('stalled relay is reconnected; credentials are reread and shutdown cancels retries', (t) => {
  const f = fixture(t);
  f.connection.start();
  f.sockets[0].open();
  t.mock.timers.tick(30000);
  f.sockets[0].receive({ type: 'heartbeat_ack', protocol: WIRE_VERSION });
  t.mock.timers.tick(30000);
  assert.equal(f.sockets.length, 1);
  t.mock.timers.tick(15000);
  assert.equal(f.sockets[0].readyState, 3);
  assert.equal(f.diagnostics.at(-1)?.code, 'RELAY_HEARTBEAT_TIMEOUT');
  t.mock.timers.tick(1501);
  assert.equal(f.sockets.length, 2);
  assert.equal(f.reads(), 2);
  f.connection.stop();
  t.mock.timers.tick(60000);
  assert.equal(f.sockets.length, 2);
});
test('invalid or missing configuration retries without crashing and recovers when fixed', (t) => {
  const f = fixture(t);
  f.setCredentials(new SyntaxError('private malformed configuration'));
  f.connection.start();
  assert.equal(f.sockets.length, 0);
  assert.equal(f.diagnostics.at(-1)?.message, 'See machine-local diagnostics');
  f.setCredentials(null);
  t.mock.timers.tick(1501);
  assert.equal(f.diagnostics.at(-1)?.code, 'RELAY_NOT_CONFIGURED');
  f.setCredentials({ relayUrl: 'https://relay.example', deviceToken: 'new-test-token' });
  t.mock.timers.tick(2501);
  assert.equal(f.sockets.length, 1);
});
test('connection loss during command never replays it or emits its response on a new connection', async (t) => {
  let calls = 0;
  let finish!: (value: unknown) => void;
  const f = fixture(t, async () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  f.connection.start();
  const original = f.sockets[0];
  original.open();
  original.receive({
    type: 'command',
    protocol: WIRE_VERSION,
    id: 'command-1',
    operation: 'call',
    args: {},
  });
  original.terminate();
  t.mock.timers.tick(1501);
  f.sockets[1].open();
  finish({ state: 'completed' });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(f.sockets.flatMap((s) => s.sent).filter((m) => m.type === 'response').length, 0);
});
