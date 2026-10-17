import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
} from '@modelcontextprotocol/server';
import { serveMcp } from '../src/mcp/server.ts';
import { GATEWAY_INSTRUCTIONS } from '../src/mcp/instructions.ts';
import { MCP_PROTOCOL_VERSION } from '@dotx/shared/protocol';
import packageInfo from '../package.json' with { type: 'json' };

const request = (method: string, params: Record<string, unknown>) =>
  new Request('https://test/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      'Mcp-Method': method,
      ...(method === 'tools/call' ? { 'Mcp-Name': String(params.name) } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MCP_PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    }),
  });
const args = {
  connection_id: 'mini',
  interface: 'app_server',
  runtime_id: 'runtime-a',
  request_id: 'request-a',
  method: 'fs/writeFile',
  params: { arbitrary: { native: true } },
};
const toolNames = [
  'list_connections',
  'describe_methods',
  'call',
  'get_request',
  'read_events',
  'respond',
];

test('MCP 2 discovery, six tools, instructions and write authorization', async () => {
  let count = 0;
  const options = {
    connections: async () => ({ connections: [] }),
    scopes: ['mcp:read'],
    invoke: async (_op: string, a: Record<string, unknown>) => {
      count++;
      return a;
    },
  };
  const discovery = await (await serveMcp(request('server/discover', {}), options)).json<any>();
  assert.deepEqual(discovery.result.supportedVersions, [MCP_PROTOCOL_VERSION]);
  assert.equal(discovery.result.resultType, 'complete');
  assert.deepEqual(discovery.result._meta[SERVER_INFO_META_KEY], {
    name: 'dotx-remote',
    title: 'DotX Remote',
    version: packageInfo.version,
  });
  assert.equal(
    discovery.result.capabilities.events,
    undefined,
    'Do not advertise unimplemented webhooks',
  );
  assert.equal(discovery.result.instructions, GATEWAY_INSTRUCTIONS);
  const list = await (await serveMcp(request('tools/list', {}), options)).json<any>();
  assert.deepEqual(
    list.result.tools.map((t: any) => t.name),
    toolNames,
  );
  const callTool = list.result.tools.find((t: any) => t.name === 'call');
  assert(callTool.inputSchema.properties.interface.enum.includes('client_coordination'));
  const denied = await (
    await serveMcp(request('tools/call', { name: 'call', arguments: args }), options)
  ).json<any>();
  assert.match(denied.result.content[0].text, /INSUFFICIENT_SCOPE/);
  assert.equal(count, 0);
  const ok = await (
    await serveMcp(request('tools/call', { name: 'call', arguments: args }), {
      ...options,
      scopes: ['mcp:read', 'mcp:write'],
    })
  ).json<any>();
  assert.deepEqual(ok.result.structuredContent.params, args.params);
  const invalid = await (
    await serveMcp(
      request('tools/call', { name: 'call', arguments: { ...args, unexpected: true } }),
      {
        ...options,
        scopes: ['mcp:read', 'mcp:write'],
      },
    )
  ).json<any>();
  assert(invalid.result?.isError || invalid.error);
  assert.equal(count, 1, 'Invalid arguments must not reach the router');
});

test('modern-only endpoint rejects old protocol and mismatched method headers before dispatch', async () => {
  let count = 0;
  const options = {
    scopes: ['mcp:read'],
    connections: async () => {
      count++;
      return {};
    },
    invoke: async () => {
      count++;
      return {};
    },
  };
  const old = new Request('https://test/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'old', version: '1' },
      },
    }),
  });
  const rejected = await (await serveMcp(old, options)).json<any>();
  assert.equal(rejected.error.code, -32022);
  const mismatch = request('tools/list', {});
  mismatch.headers.set('Mcp-Method', 'tools/call');
  const bad = await (await serveMcp(mismatch, options)).json<any>();
  assert.equal(bad.error.code, -32020);
  assert.equal(count, 0);
});
