import { McpServer, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';
import { z } from 'zod';
import packageInfo from '../package.json' with { type: 'json' };

export function createDeviceMcp(status: () => Promise<object>) {
  const server = new McpServer(
    { name: 'dotx-desktop', title: 'DotX Desktop', version: packageInfo.version },
    {
      // The desktop selects its own stdio protocol; SDK negotiation owns that boundary.
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      capabilities: { tools: {} },
      instructions:
        'Use the DotX skill and bundled docs/index.md for setup, updates and troubleshooting. device_status identifies the actual owner and host-provided paths.',
    },
  );
  server.registerTool(
    'device_status',
    {
      description:
        'Read this DotX entry role, host-provided data/docs paths and the actual connector owner’s connection, approval, versions and native health. Available before setup; read bundled docs/index.md for next steps.',
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await status()) }] }),
  );
  return server;
}
