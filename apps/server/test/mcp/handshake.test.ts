import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../support/server.ts';

test('MCP serves the standard initialize handshake and modern discovery with the same tools', async (t) => {
  const api = await startServer(t, 'paginated');
  const token = await api.authorize();
  const request = (body: object, protocol?: string) =>
    api.request('/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(protocol ? { 'MCP-Protocol-Version': protocol } : {}),
      },
      body: JSON.stringify(body),
    });
  const result = async (response: Response) => {
    assert.equal(response.status, 200);
    const text = await response.text();
    return JSON.parse(
      response.headers.get('Content-Type')?.includes('text/event-stream')
        ? text
            .split('\n')
            .find((line) => line.startsWith('data: '))!
            .slice(6)
        : text,
    ).result;
  };
  for (const protocol of ['2025-03-26', '2025-06-18', '2025-11-25']) {
    const initialized = await result(
      await request({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: protocol,
          capabilities: {},
          clientInfo: { name: 'Protocol fixture', version: '1' },
        },
      }),
    );
    assert.equal(initialized.protocolVersion, protocol);
    assert.equal(initialized.serverInfo.name, 'dotx-remote');
    assert.equal(
      (await request({ jsonrpc: '2.0', method: 'notifications/initialized' }, protocol)).status,
      202,
    );
    const tools = await result(
      await request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, protocol),
    );
    const modern = await api.rpc(token, 'tools/list');
    assert.deepEqual(
      tools.tools.map((tool: { name: string }) => tool.name),
      modern.result.tools.map((tool: { name: string }) => tool.name),
    );
    const instructions = await result(
      await request(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'get_instructions', arguments: {} },
        },
        protocol,
      ),
    );
    assert.equal(instructions.isError, undefined);
    assert(instructions.content[0].text.includes('guides'));
  }
  const guide = await api.rpc(token, 'tools/call', {
    name: 'get_instructions',
    arguments: { goal: 'authorization' },
  });
  assert.equal(guide.result.isError, undefined);
  const authorization = JSON.parse(guide.result.content[0].text);
  assert.equal(authorization.path, 'personal-agents/authorization.md');
  assert(authorization.instructions.includes('## Normal use and renewal'));
  assert(authorization.instructions.includes('expires_in'));
  assert(
    authorization.instructions.includes(
      `https://github.com/Vizards/DotX/blob/v${authorization.version}/docs/personal-agents/cue/index.md`,
    ),
  );
  // Every advertised guide is readable through MCP, including linked task nodes.
  // A client without web access must not be stranded at a GitHub-only subtask.
  const catalogCall = await api.rpc(token, 'tools/call', {
    name: 'get_instructions',
    arguments: {},
  });
  const catalog = JSON.parse(catalogCall.result.content[0].text);
  const sources = new Set<string>([catalog.source]);
  const documents = [catalog];
  for (const entry of catalog.guides) {
    const response = await api.rpc(token, 'tools/call', {
      name: 'get_instructions',
      arguments: { goal: entry.goal },
    });
    assert.equal(response.result.isError, undefined, entry.goal);
    const document = JSON.parse(response.result.content[0].text);
    assert.equal(document.path, entry.path);
    assert.equal(document.source, entry.source);
    assert.match(document.instructions, /^# /, entry.goal);
    sources.add(document.source);
    documents.push(document);
  }
  const guideRoot = new URL('.', catalog.source).href;
  for (const document of documents) {
    for (const [, href] of document.instructions.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (href.startsWith('#')) continue;
      assert.match(href, /^https?:\/\//, `${document.path}: unresolved link ${href}`);
      if (href.startsWith(guideRoot)) {
        assert(sources.has(href.split('#')[0]), `${document.path}: uncatalogued guide ${href}`);
      }
    }
  }
});
