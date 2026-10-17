import test from 'node:test';
import { errorCode } from '@dotx/shared/errors';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Native, pipeRpc } from '../src/interfaces/app-tools/transport.ts';
import { AppToolsAdapter } from '../src/interfaces/app-tools/adapter.ts';
import type { RpcObservation } from '../src/interfaces/app-tools/transport.ts';

test('native schemas are opaque: boolean schemas and new keywords survive discovery and calls', async () => {
  const inputSchema = {
    type: 'object',
    properties: { unrestricted: true, forbidden: false },
    unevaluatedProperties: false,
  };
  let calls = 0;
  const native = new Native({
    callerThreadId: 'caller-test',
    rpc: async (_pipe, method, params) => {
      if (method === 'tools/list')
        return { tools: [{ namespace: 'native', name: 'query', inputSchema, outputSchema: true }] };
      calls++;
      assert.deepEqual((params as any).arguments, { unrestricted: { newField: 1 } });
      return { arbitraryNativeResult: true };
    },
  });
  const adapter = new AppToolsAdapter({ native, version: 'future-desktop' });
  const [method] = await adapter.methods();
  assert.deepEqual(method.input_schema, inputSchema);
  assert.equal(method.output_schema, true);
  assert.deepEqual(await adapter.call(method.name, { unrestricted: { newField: 1 } }), {
    result: { arbitraryNativeResult: true },
  });
  assert.equal(calls, 1);
});

test('desktop framing supports fragmented packets and rejects mismatched responses', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-')),
    socketPath = path.join(dir, 's');
  let wrong = false;
  const server = net.createServer((s) => {
    let data = Buffer.alloc(0);
    s.on('data', (b) => {
      data = Buffer.concat([data, b]);
      if (data.length < 4 || data.length < 4 + data.readUInt32LE()) return;
      const input = JSON.parse(data.subarray(4).toString('utf8'));
      const body = Buffer.from(
        JSON.stringify({ id: wrong ? 'wrong' : input.id, result: { valid: true } }),
      );
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      s.write(header.subarray(0, 2));
      setImmediate(() => {
        s.write(header.subarray(2));
        s.end(body);
      });
    });
  });
  await new Promise<void>((r) => server.listen(socketPath, r));
  try {
    assert.deepEqual(await pipeRpc(socketPath, 'test', {}), { valid: true });
    wrong = true;
    await assert.rejects(pipeRpc(socketPath, 'test', {}), { code: 'DESKTOP_RESPONSE_MISMATCH' });
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true });
  }
});
test('unknown desktop capability schema fails before any tool dispatch', async () => {
  let dispatched = 0;
  for (const response of [{ tools: {} }, { tools: [] }]) {
    const native = new Native({
      callerThreadId: 'caller-test',
      rpc: async (pipe, method) => {
        if (method === 'tools/call') dispatched++;
        return response;
      },
    });
    await assert.rejects(native.call('read_thread', { threadId: 'target-test' }), (error) =>
      /UNSUPPORTED_|NATIVE_METHOD_CATALOG_EMPTY/.test(errorCode(error) || ''),
    );
  }
  assert.equal(dispatched, 0);
});

test('timeouts identify the blocked desktop phase without logging payloads or resending', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-'));
  const socketPath = path.join(dir, 's');
  let partial = false;
  let calls = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.once('data', () => {
      calls++;
      if (partial) socket.write(Buffer.from([1, 0]));
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  const observations: RpcObservation[] = [];
  try {
    for (const phase of ['awaiting_response', 'receiving_response']) {
      await assert.rejects(
        pipeRpc(
          socketPath,
          'tools/call',
          { tool: 'send_message_to_thread', arguments: { prompt: 'PRIVATE_SENTINEL' } },
          100,
          (event) => observations.push(event),
        ),
        (error: unknown) =>
          errorCode(error) === 'DESKTOP_TIMEOUT' &&
          error instanceof Error &&
          error.message.includes(phase),
      );
      const observation = observations.at(-1)!;
      assert.equal(observation.phase, phase);
      assert.equal(observation.operation, 'send_message_to_thread');
      assert.equal(observation.receivedBytes, partial ? 2 : 0);
      assert.equal(observation.outcome, 'DESKTOP_TIMEOUT');
      assert.ok(observation.elapsedMs >= 90);
      partial = true;
    }
    assert.equal(calls, 2);
    assert.equal(observations.length, 2);
    assert.ok(!JSON.stringify(observations).includes('PRIVATE_SENTINEL'));
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true });
  }
});

test('diagnostic persistence failure does not change a successful desktop response', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-'));
  const socketPath = path.join(dir, 's');
  const server = net.createServer((socket) => {
    socket.once('data', (data) => {
      const { id } = JSON.parse(data.subarray(4).toString());
      const body = Buffer.from(JSON.stringify({ id, result: { accepted: true } }));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      socket.end(Buffer.concat([header, body]));
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    assert.deepEqual(
      await pipeRpc(socketPath, 'tools/call', {}, 1000, () => {
        throw new Error('Disk full');
      }),
      { accepted: true },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true });
  }
});

test('capabilities are shared, failed discovery retries, and RPC failure invalidates without replay', async () => {
  let discoveries = 0,
    dispatches = 0;
  let badDiscovery = true,
    failCall = false;
  const fields = {
    list_threads: ['limit'],
    read_thread: [
      'threadId',
      'hostId',
      'cursor',
      'turnLimit',
      'includeOutputs',
      'maxOutputCharsPerItem',
    ],
    send_message_to_thread: ['threadId', 'hostId', 'prompt'],
  };
  const native = new Native({
    callerThreadId: 'caller-test',
    rpc: async (_pipe, method) => {
      if (method === 'tools/list') {
        discoveries++;
        await Promise.resolve();
        return {
          tools: badDiscovery
            ? []
            : Object.entries(fields).map(([name, keys]) => ({
                namespace: 'codex_app',
                name,
                inputSchema: { properties: Object.fromEntries(keys.map((key) => [key, {}])) },
              })),
        };
      }
      dispatches++;
      if (failCall)
        throw Object.assign(new Error('synthetic timeout'), { code: 'DESKTOP_TIMEOUT' });
      return { success: true, contentItems: [{ text: '{}' }] };
    },
  });
  await assert.rejects(native.capabilities(), { code: 'NATIVE_METHOD_CATALOG_EMPTY' });
  badDiscovery = false;
  const results = await Promise.all(Array.from({ length: 20 }, () => native.capabilities()));
  assert.equal(discoveries, 2);
  assert(results.every((r) => r === results[0]));
  await native.call('read_thread', { threadId: 'target-test' });
  assert.equal(discoveries, 2);
  failCall = true;
  await assert.rejects(
    native.call('send_message_to_thread', { threadId: 'target-test', prompt: 'synthetic' }),
    { code: 'DESKTOP_TIMEOUT' },
  );
  assert.equal(dispatches, 2, 'failed send is not replayed');
  badDiscovery = true;
  await assert.rejects(native.call('read_thread', { threadId: 'target-test' }), {
    code: 'NATIVE_METHOD_CATALOG_EMPTY',
  });
  assert.equal(dispatches, 2, 'changed capabilities block dispatch');
  badDiscovery = false;
  failCall = false;
  await native.call('read_thread', { threadId: 'target-test' });
  assert.equal(discoveries, 4);
  assert.equal(dispatches, 3);
});

test('tracked caller turn ID lives only in the private envelope; arguments and ordinary RPC stay unchanged', async () => {
  const envelopes: any[] = [];
  const native = new Native({
    callerThreadId: 'archived-caller',
    rpc: async (_pipe, method, params) => {
      if (method === 'tools/list')
        return { tools: [{ namespace: 'codex_app', name: 'send_message_to_thread' }] };
      envelopes.push(params);
      return { success: true, contentItems: [{ text: '{"threadId":"target"}' }] };
    },
  });
  const params = {
    threadId: 'target',
    hostId: 'remote-control:book',
    prompt: 'Send this unchanged',
    model: 'chosen',
    thinking: 'high',
  };
  await native.call('send_message_to_thread', params, { turnId: 'reserved-cloud-id' });
  await native.rawCall('codex_app.send_message_to_thread', params);
  assert.deepEqual(envelopes[0].arguments, params);
  assert.equal(envelopes[0].threadId, 'archived-caller');
  assert.equal(envelopes[0].turnId, 'reserved-cloud-id');
  assert.notEqual(envelopes[1].turnId, 'reserved-cloud-id');
});
