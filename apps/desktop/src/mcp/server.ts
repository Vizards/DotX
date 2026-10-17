import { McpServer, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { MCP_PROTOCOL_VERSION } from '@dotx/shared/protocol';
import packageInfo from '../../package.json' with { type: 'json' };

export function createDeviceMcp(status: () => object) {
  const server = new McpServer(
    { name: 'dotx-desktop', title: 'DotX Desktop', version: packageInfo.version },
    {
      // The desktop selects its own stdio protocol; SDK negotiation owns that boundary.
      supportedProtocolVersions: [MCP_PROTOCOL_VERSION, ...SUPPORTED_PROTOCOL_VERSIONS],
      capabilities: { tools: {}, resources: {}, prompts: {} },
    },
  );
  server.registerTool(
    'device_status',
    {
      description:
        'Read the local dot MCP connector health. Remote thread operations use the authenticated remote MCP.',
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: 'text', text: JSON.stringify(status()) }] }),
  );
  return server;
}
