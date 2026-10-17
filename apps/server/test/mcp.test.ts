import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
} from '@modelcontextprotocol/server';
import { serveMcp } from '../src/mcp/server.ts';
import { INSTRUCTIONS_GUIDANCE } from '../src/mcp/instructions.ts';
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
  'get_instructions',
  'describe_methods',
  'call',
  'get_request',
  'read_events',
  'respond',
];

test('MCP 2 discovery, seven tools, instructions and write authorization', async () => {
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
  assert.equal(discovery.result.instructions, INSTRUCTIONS_GUIDANCE);
  const list = await (await serveMcp(request('tools/list', {}), options)).json<any>();
  assert.deepEqual(
    list.result.tools.map((t: any) => t.name),
    toolNames,
  );
  for (const tool of list.result.tools) {
    assert.equal(
      tool.description.includes(INSTRUCTIONS_GUIDANCE),
      tool.name !== 'get_instructions',
      `${tool.name} should expose the guide entry point without a self-reference`,
    );
  }
  const callTool = list.result.tools.find((t: any) => t.name === 'call');
  assert(callTool.inputSchema.properties.interface.enum.includes('client_coordination'));
  const connections = await (
    await serveMcp(request('tools/call', { name: 'list_connections', arguments: {} }), options)
  ).json<any>();
  assert.deepEqual(connections.result.structuredContent, {
    connections: [],
  });
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

test('instruction discovery returns a directory and reads only the requested goal without a connector', async () => {
  const options = {
    scopes: ['mcp:read'],
    connections: async () => assert.fail('Guides must not require a connection'),
    invoke: async () => assert.fail('Guides must not dispatch native calls'),
  };
  const read = async (args: Record<string, unknown>) =>
    (
      await serveMcp(request('tools/call', { name: 'get_instructions', arguments: args }), options)
    ).json<any>();
  const directory = await read({});
  const { guides, ...rest } = directory.result.structuredContent;
  assert.deepEqual(rest, {}, 'The directory must not preload any guide body');
  assert(guides.length > 0);
  assert.deepEqual(JSON.parse(directory.result.content[0].text), { guides });
  for (const guide of guides) {
    assert.deepEqual(Object.keys(guide).sort(), ['description', 'goal', 'title']);
    const response = await read({ goal: guide.goal });
    const { instructions, ...metadata } = response.result.structuredContent;
    assert.deepEqual(metadata, guide, 'Each directory entry must resolve to its own guide');
    assert.equal(typeof instructions, 'string');
    assert(instructions.length > 0);
    assert.deepEqual(
      JSON.parse(response.result.content[0].text),
      response.result.structuredContent,
      'The selected guide must be available in model-visible content',
    );
  }
  for (const goal of ['unknown', 'all']) {
    const invalid = await read({ goal });
    assert(invalid.result?.isError || invalid.error, 'Unknown goals must not return all guides');
  }
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
