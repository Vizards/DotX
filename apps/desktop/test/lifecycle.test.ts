import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { WebSocketServer } from 'ws';
import { WIRE_VERSION } from '@dotx/shared/gateway';
import { MCP_PROTOCOL_VERSION } from '@dotx/shared/protocol';

const mac = { skip: process.platform !== 'darwin', timeout: 30000 };
const root = fileURLToPath(new URL('../', import.meta.url));

async function until<T>(read: () => T, message: string): Promise<NonNullable<T>> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await delay(25);
  }
  throw new Error(message);
}

async function fixture(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dx-'));
  const state = path.join(dir, 'state');
  const home = path.join(dir, 'home');
  const app = path.join(dir, 'Fixture.app');
  const resources = path.join(app, 'Contents/Resources');
  fs.mkdirSync(state);
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(resources, 'cua_node/bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(resources, 'cua_node/bin/node'));
  fs.writeFileSync(
    path.join(app, 'Contents/Info.plist'),
    '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>test</string></dict></plist>',
  );
  await build({
    entryPoints: [path.join(root, 'test/fixtures/desktop-cli.ts')],
    outfile: path.join(resources, 'codex'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: { js: '#!/usr/bin/env node' },
  });
  fs.chmodSync(path.join(resources, 'codex'), 0o700);

  // Real plugin/runtime, with only the external desktop and relay replaced by local fixtures.
  const bundles = await Promise.all(
    ['0.0.1-test.1', '0.0.1-test.2'].map(async (version) => {
      const outfile = path.join(dir, version, 'plugin.mjs');
      await build({
        entryPoints: [path.join(root, 'src/plugin.ts')],
        outfile,
        bundle: true,
        platform: 'node',
        format: 'esm',
        external: ['bufferutil', 'utf-8-validate'],
        banner: {
          js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
        },
        plugins: [
          {
            name: 'fixture-version',
            setup(build) {
              build.onLoad({ filter: /package\.json$/ }, (args) => {
                if (args.path !== path.join(root, 'package.json')) return;
                return { contents: JSON.stringify({ version }), loader: 'json' };
              });
            },
          },
        ],
      });
      return outfile;
    }),
  );
  const config = {
    protocol: 1,
    deviceId: 'synthetic-device',
    callerThreadId: 'synthetic-caller',
    label: 'Lifecycle fixture',
    codexHome: home,
  };
  const configure = () => fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify(config));
  configure();

  const pipe = path.join(dir, 'p');
  const nativeSockets = new Set<net.Socket>();
  let nativeCalls = 0;
  const native = net.createServer((socket) => {
    nativeSockets.add(socket);
    socket.on('close', () => nativeSockets.delete(socket));
    let bytes = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length < 4 || bytes.length < bytes.readUInt32LE() + 4) return;
      const request = JSON.parse(bytes.subarray(4).toString());
      nativeCalls++;
      const result =
        request.method === 'tools/list'
          ? { tools: [{ namespace: 'codex_app', name: 'read_thread', inputSchema: {} }] }
          : {
              success: true,
              contentItems: [
                {
                  text: JSON.stringify({
                    schemaVersion: 1,
                    thread: { id: config.callerThreadId, kind: 'codex', hostId: 'local' },
                    turns: [],
                    page: { hasMore: false, nextCursor: null },
                  }),
                },
              ],
            };
      const body = Buffer.from(JSON.stringify({ id: request.id, result }));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      socket.end(Buffer.concat([header, body]));
    });
  });
  await new Promise<void>((resolve) => native.listen(pipe, resolve));
  const relay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => relay.once('listening', resolve));
  fs.writeFileSync(
    path.join(state, 'connection.json'),
    JSON.stringify({
      relayUrl: `http://127.0.0.1:${(relay.address() as net.AddressInfo).port}`,
      deviceToken: 'synthetic-token',
    }),
  );
  const heartbeats: any[] = [];
  let maxConnections = 0;
  let connections = 0;
  relay.on('connection', (socket) => {
    connections++;
    maxConnections = Math.max(maxConnections, relay.clients.size);
    socket.on('message', (bytes) => {
      const packet = JSON.parse(String(bytes));
      if (packet.type === 'heartbeat') {
        heartbeats.push(packet);
        socket.send(JSON.stringify({ type: 'heartbeat_ack', protocol: WIRE_VERSION }));
      }
    });
  });
  const children = () => {
    const file = path.join(home, 'children.jsonl');
    return fs.existsSync(file)
      ? fs
          .readFileSync(file, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((s) => JSON.parse(s))
      : [];
  };
  const processes: {
    child: ChildProcessWithoutNullStreams;
    exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  }[] = [];
  function start(version = 0, withPipe = true) {
    // Inherit no real desktop, service, credential or caller configuration.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('CODEX_') && !key.startsWith('DOTX_'),
      ),
    );
    const child = spawn(process.execPath, [bundles[version]], {
      env: {
        ...env,
        DOTX_STATE_DIR: state,
        DOTX_APP_PATH: app,
        ...(withPipe ? { CODEX_APP_TOOLS_PIPE_PATH: pipe } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (b) => {
      stderr += b;
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    );
    const replies = new Map<number, any>();
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const reply = JSON.parse(line);
      replies.set(reply.id, reply);
    });
    let id = 0;
    const request = async (method: string, params: unknown) => {
      const current = ++id;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: current, method, params }) + '\n');
      const reply = await until(() => replies.get(current), `MCP ${method} timed out: ${stderr}`);
      assert.equal(reply.error, undefined);
      return reply.result;
    };
    const p = {
      child,
      exited,
      stderr: () => stderr,
      async status() {
        await request('initialize', {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'fixture', version: '1' },
        });
        child.stdin.write(
          JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
        );
        const result = await request('tools/call', { name: 'device_status', arguments: {} });
        return JSON.parse(result.content[0].text);
      },
    };
    processes.push(p);
    return p;
  }
  t.after(async () => {
    for (const p of processes)
      if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGKILL');
    await Promise.all(processes.map((p) => p.exited));
    for (const socket of relay.clients) socket.terminate();
    await new Promise<void>((resolve) => relay.close(() => resolve()));
    for (const socket of nativeSockets) socket.destroy();
    await new Promise<void>((resolve) => native.close(() => resolve()));
    await until(
      () =>
        children()
          .filter((x) => x.event === 'start')
          .every((x) => {
            try {
              process.kill(x.pid, 0);
              return false;
            } catch {
              return true;
            }
          }),
      'App Server child leaked',
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const ready = (version: string) =>
    until(
      () => heartbeats.find((h) => h.connectorVersion === version && h.availability === 'online'),
      `No online heartbeat for ${version}`,
    );
  return {
    dir,
    state,
    pipe,
    home,
    start,
    configure,
    ready,
    children,
    heartbeats,
    relay,
    nativeCalls: () => nativeCalls,
    connections: () => connections,
    maxConnections: () => maxConnections,
  };
}

test(
  'concurrent plugin starts create one App Server and relay connection; waiters still serve MCP',
  mac,
  async (t) => {
    const f = await fixture(t);
    const batch = Array.from({ length: 8 }, () => f.start());
    await f.ready('0.0.1-test.1');
    const statuses = await Promise.all(batch.map((p) => p.status()));
    assert.equal(
      statuses.filter((s) => s.diagnostic?.code === 'CONNECTOR_ACTIVE_ELSEWHERE').length,
      7,
    );
    assert.equal(statuses.filter((s) => s.availability === 'standby').length, 7);
    assert.equal(statuses.filter((s) => s.instanceId).length, 1);
    await delay(2200); // Exercise more than one occupied-lock retry, not just initial admission.
    assert.equal(f.children().filter((x) => x.event === 'start').length, 1);
    assert.equal(f.nativeCalls(), 2);
    assert.equal(f.connections(), 1);
    assert.equal(f.maxConnections(), 1);
    // A network reconnect must retain the local owner, not start another runtime.
    for (const socket of f.relay.clients) socket.terminate();
    await until(() => f.connections() === 2, 'owner did not reconnect');
    assert.equal(new Set(f.heartbeats.map((h) => h.instanceId)).size, 1);
    assert.equal(f.children().filter((x) => x.event === 'start').length, 1);
    assert.equal(f.maxConnections(), 1);
  },
);

test(
  'fatal initialization and lock-file errors exit instead of holding an unusable installation',
  mac,
  async (t) => {
    const f = await fixture(t);
    fs.writeFileSync(path.join(f.state, 'config.json'), '{');
    const malformed = f.start();
    assert.equal((await malformed.exited).code, 1);
    assert.match(malformed.stderr(), /CONNECTOR_START_FAILED/);
    f.configure();
    // Fail after App Server construction, exercising partial-startup cleanup.
    fs.writeFileSync(path.join(f.state, 'instances'), 'cannot be a directory');
    const partial = f.start();
    assert.equal((await partial.exited).code, 1);
    assert.match(partial.stderr(), /CONNECTOR_START_FAILED/);
    fs.unlinkSync(path.join(f.state, 'instances'));
    fs.unlinkSync(path.join(f.state, 'connector.lock')); // No live owner; inject an actual open error.
    fs.mkdirSync(path.join(f.state, 'connector.lock'));
    const blocked = f.start();
    assert.equal((await blocked.exited).code, 1);
    assert.match(blocked.stderr(), /CONNECTOR_LOCK_FAILED \(EISDIR\)/);
    fs.rmdirSync(path.join(f.state, 'connector.lock'));
    f.start();
    await f.ready('0.0.1-test.1');
    assert.equal(f.connections(), 1);
  },
);

for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
  test(
    `${signal} releases ownership; a new-version waiter takes over without preempting`,
    mac,
    async (t) => {
      const f = await fixture(t);
      const old = f.start();
      await f.ready('0.0.1-test.1');
      const updated = f.start(1);
      assert.equal((await updated.status()).diagnostic.code, 'CONNECTOR_ACTIVE_ELSEWHERE');
      await delay(1200);
      assert.equal(f.connections(), 1);
      assert.equal(f.children().filter((x) => x.event === 'start').length, 1);
      old.child.kill(signal);
      await old.exited;
      await f.ready('0.0.1-test.2');
      assert.equal(f.maxConnections(), 1);
      assert.equal(f.connections(), 2);
      assert.ok(fs.existsSync(path.join(f.state, 'connector.lock')));
      assert.equal(
        f
          .children()
          .filter((x) => x.event === 'initialize')
          .at(-1).version,
        '0.0.1-test.2',
      );
    },
  );
}

test(
  'discovery EOF preserves ownership; desktop pipe removal stops owner and waiters',
  mac,
  async (t) => {
    const f = await fixture(t);
    const owner = f.start();
    await f.ready('0.0.1-test.1');
    const waiter = f.start();
    assert.equal((await waiter.status()).diagnostic.code, 'CONNECTOR_ACTIVE_ELSEWHERE');
    owner.child.stdin.end();
    waiter.child.stdin.end();
    await delay(1200);
    assert.equal(owner.child.exitCode, null);
    assert.equal(waiter.child.exitCode, null);
    assert.equal(f.connections(), 1);
    fs.unlinkSync(f.pipe);
    assert.equal((await owner.exited).code, 0);
    assert.equal((await waiter.exited).code, 0);
    await until(() => f.relay.clients.size === 0, 'relay remained connected after desktop exit');
    assert.equal(f.connections(), 1);
  },
);

test('without a desktop pipe, stdio EOF exits and releases the lock', mac, async (t) => {
  const f = await fixture(t);
  const owner = f.start(0, false);
  await until(() => f.connections() === 1, 'no relay connection');
  owner.child.stdin.end();
  assert.equal((await owner.exited).code, 0);
  f.start(1);
  await f.ready('0.0.1-test.2');
  assert.equal(f.maxConnections(), 1);
});

test(
  'installation after discovery EOF starts once; restarting all instances loads the new bundle',
  mac,
  async (t) => {
    const f = await fixture(t);
    fs.unlinkSync(path.join(f.state, 'config.json'));
    const processes = [f.start(), f.start()];
    for (const p of processes) {
      assert.equal((await p.status()).diagnostic.code, 'SETUP_REQUIRED');
      p.child.stdin.end();
    }
    assert.equal(f.children().length, 0);
    assert.equal(f.connections(), 0);
    f.configure();
    await f.ready('0.0.1-test.1');
    assert.equal(f.connections(), 1);
    const saved = ['config.json', 'connection.json'].map((name) =>
      fs.readFileSync(path.join(f.state, name), 'utf8'),
    );
    for (const p of processes) p.child.kill('SIGTERM');
    await Promise.all(processes.map((p) => p.exited));
    await until(() => f.relay.clients.size === 0, 'old relay connection did not close');
    f.start(1);
    await f.ready('0.0.1-test.2');
    assert.deepEqual(
      ['config.json', 'connection.json'].map((name) =>
        fs.readFileSync(path.join(f.state, name), 'utf8'),
      ),
      saved,
    );
    assert.equal(f.maxConnections(), 1);
  },
);
