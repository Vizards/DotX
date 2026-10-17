import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { CoordinationAdapter } from '../apps/desktop/src/interfaces/coordination/adapter.ts';
import {
  CoordinationWire,
  applyStatePatches,
} from '../apps/desktop/src/interfaces/coordination/transport.ts';
import { EventBuffer } from '../apps/desktop/src/events/buffer.ts';
import { Observations } from '../apps/desktop/src/relay/observations.ts';
import { coordinator, auth } from '../apps/server/test/fixtures/coordinator.ts';
import { safeError } from '@dotx/shared/errors';
import type { GatewayOperation } from '@dotx/shared/gateway';
import { Gateway } from '../apps/desktop/src/gateway/dispatcher.ts';
import type { TurnTracker } from '../apps/desktop/src/tracking/tracker.ts';
import type { NativeEvent } from '@dotx/shared/gateway';
import { matchesEvent } from '@dotx/shared/events';
import type { Method } from '../apps/desktop/src/interfaces/adapter.ts';

const catalog: Method[] = [
  {
    name: 'thread/settings/update',
    kind: 'request',
    input_schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        approvalPolicy: { type: 'string' },
        permissions: { type: 'string' },
        collaborationMode: { type: 'object' },
        serviceTier: { type: ['string', 'null'] },
      },
    },
  },
  {
    name: 'item/commandExecution/requestApproval',
    kind: 'server_request',
    input_schema: {},
    output_schema: {
      type: 'object',
      properties: { decision: { enum: ['accept', 'decline', 'cancel'] } },
      required: ['decision'],
      additionalProperties: false,
    },
  },
  {
    name: 'item/tool/requestUserInput',
    kind: 'server_request',
    input_schema: {},
    output_schema: {
      type: 'object',
      properties: {
        answers: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: { answers: { type: 'array', items: { type: 'string' } } },
            required: ['answers'],
          },
        },
      },
      required: ['answers'],
    },
  },
];
const delay = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean) {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await delay();
  }
  assert.fail('Condition not reached');
}
async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-coord-'));
  const endpoint = path.join(dir, 'ipc');
  const sockets = new Set<net.Socket>(),
    followers = new Set<net.Socket>();
  const actions: any[] = [];
  let state: any = {
    id: 'synthetic',
    hostId: 'local',
    title: 'Synthetic',
    cwd: dir,
    requests: [],
    latestThreadSettings: { permissions: ':workspace', approvalPolicy: 'on-request' },
    currentPermissions: { sandboxPolicy: { type: 'workspaceWrite' } },
    turns: [{ turnId: 'turn-a', status: 'inProgress', items: [] }],
  };
  let owner = 'desktop-owner',
    ownerAvailable = true,
    stateVersion = 11,
    revision = 1,
    dropReply = false;
  const write = (s: net.Socket, m: any) => {
    const b = Buffer.from(JSON.stringify(m)),
      h = Buffer.alloc(4);
    h.writeUInt32LE(b.length);
    s.write(Buffer.concat([h, b]));
  };
  const snapshot = (s: net.Socket) =>
    write(s, {
      type: 'broadcast',
      method: 'thread-stream-state-changed',
      version: stateVersion,
      sourceClientId: owner,
      params: {
        hostId: 'local',
        conversationId: 'synthetic',
        change: { type: 'snapshot', revision, conversationState: state },
      },
    });
  const publish = () => {
    revision++;
    for (const s of followers) snapshot(s);
  };
  const server = net.createServer((s) => {
    sockets.add(s);
    let buffer = Buffer.alloc(0);
    s.on('close', () => {
      sockets.delete(s);
      followers.delete(s);
    });
    s.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const n = buffer.readUInt32LE();
        if (buffer.length < n + 4) return;
        const m = JSON.parse(buffer.subarray(4, n + 4).toString());
        buffer = buffer.subarray(n + 4);
        if (m.type === 'broadcast') {
          if (m.params.following) {
            followers.add(s);
            snapshot(s);
          } else followers.delete(s);
          continue;
        }
        if (m.type !== 'request') continue;
        const reply = (result: any) =>
          write(s, {
            type: 'response',
            method: m.method,
            requestId: m.requestId,
            resultType: 'success',
            handledByClientId: owner,
            result,
          });
        if (m.method === 'initialize') {
          reply({ clientId: 'connector-' + sockets.size });
          continue;
        }
        if (m.method === 'thread-owner-discovery') {
          if (ownerAvailable) reply({ supportsUntrustedAppInput: true });
          else
            write(s, {
              type: 'response',
              requestId: m.requestId,
              resultType: 'error',
              error: 'no-client-found',
            });
          continue;
        }
        actions.push(m);
        if (dropReply) {
          s.destroy();
          continue;
        }
        if (m.method === 'thread-follower-update-thread-settings') {
          state.latestThreadSettings = {
            ...state.latestThreadSettings,
            ...m.params.threadSettings,
          };
          publish();
          reply({ applied: true });
        } else if (
          m.method === 'thread-follower-command-approval-decision' ||
          m.method === 'thread-follower-submit-user-input'
        ) {
          state.requests = state.requests.filter((r: any) => r.id !== m.params.requestId);
          publish();
          reply({ ok: true });
        }
      }
    });
  });
  server.listen(endpoint);
  await once(server, 'listening');
  fs.chmodSync(endpoint, 0o600);
  const adapters: CoordinationAdapter[] = [];
  const gateways = new Map<string, Gateway>();
  const { cloud } = coordinator(async (op, args) => {
    const g = gateways.get(args.runtime_id as string);
    if (!g) return { ok: false, error: { code: 'RUNTIME_CHANGED' } };
    try {
      return { ok: true, result: await g.execute(op, args) };
    } catch (error) {
      return { ok: false, error: safeError(error) };
    }
  });
  const g = { execute: (op: GatewayOperation, args: unknown) => cloud.invoke(auth, op, args) };
  const make = async (version = 'synthetic-desktop') => {
    const q = new Observations();
    const j = new EventBuffer((e) => q.native(e));
    const a = new CoordinationAdapter({
      home: dir,
      endpoint,
      version,
      connectionId: 'mini',
      events: j,
      nativeCatalog: catalog,
      timeoutMs: 200,
      refreshMs: 60000,
    });
    adapters.push(a);
    await until(() => a.ready || Boolean(a.diagnostic));
    const gateway = new Gateway({
      resolveTurn: async () => null,
      connectionId: 'mini',
      events: j,
      tracker: {} as TurnTracker,
      adapters: new Map([['client_coordination', a]]),
    });
    gateways.set(a.runtimeId, gateway);
    const restore = await cloud.restore('mini');
    a.view.restore(restore.follows);
    await a.refresh();
    return { a, j, g, q };
  };
  const first = await make();
  const follow = async (a = first.a) => {
    gateways.set(
      a.runtimeId,
      gateways.get(
        [...gateways.keys()].find(
          (k) => gateways.get(k)?.adapters.get('client_coordination') === a,
        )!,
      )!,
    );
    const r = await cloud.invoke(auth, 'call', {
      connection_id: 'mini',
      interface: 'client_coordination',
      runtime_id: a.runtimeId,
      request_id: crypto.randomUUID(),
      method: 'thread-stream-following-changed',
      params: { hostId: 'local', conversationId: 'synthetic', following: true },
    });
    if (r.rpc_status !== 'returned')
      throw Object.assign(Error(r.diagnostic?.message), r.diagnostic);
    return r.native;
  };
  const events = (a = first.a, j = first.j) =>
    j.events(a.runtimeId, undefined, 100).events.map((e) => a.decorateEvent(e));
  const question = () => ({
    type: 'agentMessage',
    id: 'question-a',
    delivery: 'async',
    questions: [{ title: 'Choose color', options: ['BLUE', 'GREEN'] }],
  });
  return {
    ...first,
    make,
    follow,
    events,
    actions,
    question,
    cloud,
    async read(a = first.a) {
      return cloud.invoke(auth, 'read_events', {
        connection_id: 'mini',
        interface: 'client_coordination',
        runtime_id: a.runtimeId,
      });
    },
    get state() {
      return state;
    },
    set state(v) {
      state = v;
    },
    publish,
    owner: (v: string) => {
      owner = v;
    },
    ownerAvailable: (v: boolean) => {
      ownerAvailable = v;
    },
    stateVersion: (v: number) => {
      stateVersion = v;
    },
    drop: () => {
      dropReply = true;
    },
    restore: () => {
      dropReply = false;
    },
    async close() {
      for (const a of adapters) a.close();
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
      await delay();
      fs.rmSync(dir, { recursive: true, force: true });
    },
    async disconnect() {
      for (const s of sockets) s.destroy();
      await until(() => !first.a.ready);
    },
  };
}
const approval = {
  id: 31,
  method: 'item/commandExecution/requestApproval',
  params: { turnId: 'turn-a', threadId: 'synthetic', command: 'synthetic-command' },
};
const answer = { result: { decision: 'accept' } };
const serverEvent = (events: NativeEvent[]) => events.find((e) => e.kind === 'server_request')!;

test('desktop release labels do not gate a working coordination protocol', async () => {
  const f = await fixture();
  try {
    for (const version of ['previous-release', 'new-release']) {
      const { a } = await f.make(version);
      assert.equal(a.ready, true);
      const observed: any = await f.follow(a);
      assert.equal(observed.result.latestThreadSettings.approvalPolicy, 'on-request');
    }
  } finally {
    await f.close();
  }
});

test('actual incompatible snapshot protocol fails before a settings write', async () => {
  const f = await fixture();
  try {
    f.stateVersion(12);
    await assert.rejects(
      f.a.call('thread-follower-update-thread-settings', {
        conversationId: 'synthetic',
        threadSettings: { approvalPolicy: 'never' },
      }),
      { code: 'COORDINATION_STATE_VERSION_MISMATCH' },
    );
    assert.equal(f.a.ready, false);
    assert.equal(f.a.diagnostic, 'COORDINATION_STATE_VERSION_MISMATCH');
    assert.deepEqual(f.actions, []);
  } finally {
    await f.close();
  }
});

test('desktop settings update and verified snapshot preserve next-turn settings, no implicit task creation', async () => {
  const f = await fixture();
  try {
    await f.follow();
    const result = await f.a.call('thread-follower-update-thread-settings', {
      conversationId: 'synthetic',
      threadSettings: { permissions: ':danger-full-access', approvalPolicy: 'never' },
    });
    assert.deepEqual(result, { result: { applied: true } });
    const observed: any = await f.follow();
    assert.equal(observed.result.latestThreadSettings.permissions, ':danger-full-access');
    assert.equal(f.state.currentPermissions.sandboxPolicy.type, 'workspaceWrite');
    assert.deepEqual(
      f.actions.map((x) => x.method),
      ['thread-follower-update-thread-settings'],
    );
  } finally {
    await f.close();
  }
});
test('different plugin events for one approval share an atomic response reservation', async () => {
  const f = await fixture();
  try {
    f.state.requests = [approval];
    await f.follow();
    const other = await f.make();
    await f.follow(other.a);
    const e1 = serverEvent(f.events()),
      e2 = serverEvent(f.events(other.a, other.j));
    assert.notEqual(e1.event_id, e2.event_id);
    assert.equal(e1.interaction_key, e2.interaction_key);
    await f.read();
    await f.read(other.a);
    await Promise.allSettled([
      f.g.execute('respond', { event_id: e1.event_id, response: answer }),
      other.g.execute('respond', { event_id: e2.event_id, response: answer }),
    ]);
    assert.equal(f.actions.length, 1);
    await f.read(other.a);
    const repeat: any = await other.g.execute('respond', {
      event_id: e2.event_id,
      response: answer,
    });
    assert.equal(repeat.response_status, 'resolved');
    assert.equal(f.actions.length, 1);
    await assert.rejects(
      other.g.execute('respond', {
        event_id: e2.event_id,
        response: { result: { decision: 'decline' } },
      }),
      { code: 'IDEMPOTENCY_CONFLICT' },
    );
  } finally {
    await f.close();
  }
});
test('malformed answer and an approval already handled locally never reach the desktop', async () => {
  const f = await fixture();
  try {
    f.state.requests = [approval];
    await f.follow();
    const e = serverEvent(f.events());
    await f.read();
    const invalid = await f.g.execute('respond', {
      event_id: e.event_id,
      response: { result: { decision: 'arbitrary' } },
    });
    assert.equal(invalid.response_status, 'rejected');
    assert.equal(invalid.diagnostic.code, 'INVALID_INTERACTION_RESPONSE');
    f.state.requests = [];
    f.publish();
    await delay();
    const stale = await f.g.execute('respond', { event_id: e.event_id, response: answer });
    assert.equal(stale.response_status, 'rejected');
    assert.equal(stale.diagnostic.code, 'SERVER_REQUEST_NOT_PENDING');
    assert.equal(f.actions.length, 0);
  } finally {
    await f.close();
  }
});
test('synchronous input submits the exact native requestId and native answers', async () => {
  const f = await fixture();
  try {
    f.state.requests = [
      {
        id: 42,
        method: 'item/tool/requestUserInput',
        params: { turnId: 'turn-a', questions: [{ id: 'color' }] },
      },
    ];
    await f.follow();
    const e = serverEvent(f.events());
    await f.read();
    const result = { answers: { color: { answers: ['BLUE'] } } };
    const response: any = await f.g.execute('respond', {
      event_id: e.event_id,
      response: { result },
    });
    assert.equal(response.response_status, 'resolved');
    assert.equal(f.actions[0].method, 'thread-follower-submit-user-input');
    assert.deepEqual(f.actions[0].params, {
      conversationId: 'synthetic',
      requestId: 42,
      response: result,
    });
  } finally {
    await f.close();
  }
});
for (const running of [true, false])
  test(
    'async question is a notification without an answer ledger: ' +
      (running ? 'running' : 'completed'),
    async () => {
      const f = await fixture();
      try {
        f.state.turns[0].status = running ? 'inProgress' : 'completed';
        f.state.turns[0].items = [f.question()];
        const observed: any = await f.follow();
        const event = f.events().find((e) => e.native.method === 'request_user_input_async')!;
        assert.equal(event.kind, 'notification');
        assert.equal(event.response_schema, undefined);
        assert.equal(event.response_status, undefined);
        assert.deepEqual((event.native.params as any).questions, f.question().questions);
        assert.deepEqual(observed.result.interactions, []);
        assert.equal(f.a.view.get(event.interaction_key!), null);
        assert.equal(
          (await f.a.methods()).find((m) => m.name === event.native.method)?.kind,
          'notification',
        );
        await assert.rejects(
          f.g.execute('respond', { event_id: event.event_id, response: { result: 'GREEN' } }),
          { code: 'EVENT_NOT_FOUND' },
        );
        assert.deepEqual(f.actions, []);
        await f.follow();
        assert.equal(f.events().filter((e) => e.native.method === event.native.method).length, 1);
      } finally {
        await f.close();
      }
    },
  );
test('async notifications are reconstructed from the current native snapshot after restart', async () => {
  const f = await fixture();
  try {
    f.state.turns[0].items = [f.question()];
    await f.follow();
    const other = await f.make();
    await f.follow(other.a);
    f.a.close();
    const restarted = await f.make();
    await f.follow(restarted.a);
    const notices = restarted.q
      .pending()
      .filter((e) => e.kind === 'notice')
      .map((e) => e.notice)
      .filter((e) => e.data.method === 'request_user_input_async');
    assert.equal(notices.length, 1);
    const notice = notices[0];
    assert(matchesEvent('gateway.native.event', { connection_id: 'mini' }, notice));
    assert(
      !matchesEvent(
        'gateway.native.event',
        { connection_id: 'mini', kinds: ['server_request'] },
        notice,
      ),
    );
    assert(
      matchesEvent(
        'gateway.native.event',
        { connection_id: 'mini', kinds: ['notification'] },
        notice,
      ),
    );
    assert(!JSON.stringify(notice).includes('Choose color'));
    const original = restarted.j.events(notice.data.runtime_id, notice.data.read_cursor, 1)
      .events[0];
    assert.equal(original.event_id, notice.data.source_event_id);
    assert.equal(original.kind, 'notification');
    assert.deepEqual(f.actions, []);
  } finally {
    await f.close();
  }
});
test('settings remain readable while state notifications only describe runtime and turns', async () => {
  const f = await fixture();
  try {
    const first: any = await f.follow();
    assert.equal(first.result.title, undefined);
    assert.equal(first.result.cwd, undefined);
    assert.equal(first.result.ownerClientId, undefined);
    assert.equal(first.result.revision, undefined);
    const events = () =>
      f.events().filter((e) => e.native.method === 'thread-stream-state-changed');
    assert.deepEqual(Object.keys(events()[0].native.params as object).sort(), [
      'conversationId',
      'hostId',
      'threadRuntimeStatus',
      'turns',
    ]);
    await f.a.call('thread-follower-update-thread-settings', {
      conversationId: 'synthetic',
      threadSettings: { serviceTier: 'priority' },
    });
    f.state.title = 'Renamed';
    f.state.turns[0].items.push({ type: 'agentMessage', text: 'token stream' });
    const refreshed: any = await f.follow();
    assert.equal(refreshed.result.latestThreadSettings.serviceTier, 'priority');
    assert.equal(events().length, 1);
    f.state.turns[0].status = 'completed';
    await f.follow();
    assert.equal((events().at(-1)!.native.params as any).turns[0].status, 'completed');
    assert(
      f.q
        .pending()
        .filter((e) => e.kind === 'notice')
        .map((e) => e.notice)
        .some(
          (n) => n.data.method === 'thread-stream-state-changed' && n.data.status === 'completed',
        ),
    );
  } finally {
    await f.close();
  }
});
test('lost answer response remains unknown across reconnect and plugin instances; no replay', async () => {
  const f = await fixture();
  try {
    f.state.requests = [approval];
    await f.follow();
    const e = serverEvent(f.events());
    await f.read();
    f.drop();
    const lost = await f.g.execute('respond', { event_id: e.event_id, response: answer });
    assert.equal(lost.response_status, 'unknown');
    assert.equal(f.actions.length, 1);
    f.restore();
    await f.a.refresh();
    await until(() => f.a.ready);
    await f.follow();
    const newEvent = serverEvent(f.events());
    await f.read();
    assert.notEqual(newEvent.event_id, e.event_id);
    const reply: any = await f.g.execute('respond', {
      event_id: newEvent.event_id,
      response: answer,
    });
    assert.equal(reply.response_status, 'unknown');
    assert.equal(f.actions.length, 1);
    const other = await f.make();
    await f.follow(other.a);
    await f.read(other.a);
    await other.g.execute('respond', {
      event_id: serverEvent(f.events(other.a, other.j)).event_id,
      response: answer,
    });
    assert.equal(f.actions.length, 1);
  } finally {
    await f.close();
  }
});
test('persisted subscriptions restore after restart and owner rediscovery; answered questions stay answered', async () => {
  const f = await fixture();
  try {
    f.state.requests = [approval];
    await f.follow();
    const e = serverEvent(f.events());
    await f.read();
    await f.g.execute('respond', { event_id: e.event_id, response: answer });
    f.a.close();
    await delay();
    f.owner('new-desktop-owner');
    f.state.requests = [{ ...approval, id: 32 }];
    const other = await f.make();
    await until(() => f.events(other.a, other.j).some((e) => e.kind === 'server_request'));
    const fresh = serverEvent(f.events(other.a, other.j));
    assert.equal(fresh.native.id, 32);
    assert.equal(fresh.response_status, 'pending');
    assert.equal(f.actions.length, 1);
  } finally {
    await f.close();
  }
});
test('patch application rejects prototype paths and maintains native array semantics', () => {
  assert.deepEqual(
    applyStatePatches({ a: [1, 3] }, [
      { op: 'add', path: ['a', 1], value: 2 },
      { op: 'remove', path: ['a', 0] },
    ]),
    { a: [2, 3] },
  );
  assert.throws(
    () => applyStatePatches({}, [{ op: 'add', path: ['__proto__', 'polluted'], value: true }]),
    { code: 'COORDINATION_INVALID_PATCH' },
  );
  assert.equal(({} as any).polluted, undefined);
});

test('unloaded desktop thread reports owner unavailable and restores without a new runtime or task', async () => {
  const f = await fixture();
  try {
    const runtime = f.a.runtimeId;
    await f.follow();
    f.ownerAvailable(false);
    await assert.rejects(f.follow(), {
      code: 'COORDINATION_OWNER_UNAVAILABLE',
      message: 'no-client-found',
    });
    await f.a.refresh();
    assert.equal(f.a.ready, true);
    assert.equal(f.a.runtimeId, runtime);
    assert.deepEqual(f.events().at(-1)?.native.params, {
      hostId: 'local',
      conversationId: 'synthetic',
      code: 'COORDINATION_OWNER_UNAVAILABLE',
    });
    f.ownerAvailable(true);
    f.state.requests = [approval];
    await f.a.refresh();
    assert.equal(serverEvent(f.events()).native.id, 31);
    assert.equal(f.actions.length, 0);
  } finally {
    await f.close();
  }
});

test('initialization timeout closes its socket before a fresh connection is attempted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-coord-init-'));
  const endpoint = path.join(dir, 'ipc');
  const sockets = new Set<net.Socket>();
  let attempts = 0;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    const attempt = ++attempts;
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4 || buffer.length < buffer.readUInt32LE() + 4 || attempt === 1) return;
      const message = JSON.parse(buffer.subarray(4).toString());
      const body = Buffer.from(
        JSON.stringify({
          type: 'response',
          method: message.method,
          requestId: message.requestId,
          resultType: 'success',
          result: { clientId: 'fresh-connection' },
        }),
      );
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
  });
  server.listen(endpoint);
  await once(server, 'listening');
  fs.chmodSync(endpoint, 0o600);
  const wire = new CoordinationWire({ endpoint, timeoutMs: 20, onMessage() {}, onDisconnect() {} });
  try {
    await assert.rejects(wire.connect(), { code: 'COORDINATION_TIMEOUT' });
    assert.equal(wire.socket, undefined);
    await until(() => sockets.size === 0);
    await wire.connect();
    assert.equal(wire.clientId, 'fresh-connection');
    assert.equal(sockets.size, 1);
  } finally {
    wire.close();
    for (const socket of sockets) socket.destroy();
    server.close();
    await once(server, 'close');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
