import { subscribeSchema, unsubscribeSchema } from '@dotx/shared/events';
import { McpServer, createMcpHandler, ProtocolError } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { gatewaySchemas } from '@dotx/shared/gateway';
import type { GatewayOperation } from '@dotx/shared/gateway';
import { errorCode } from '@dotx/shared/errors';
import { MCP_PROTOCOL_VERSION } from '@dotx/shared/protocol';
import packageInfo from '../../package.json' with { type: 'json' };
import { GATEWAY_INSTRUCTIONS, INSTRUCTIONS_GUIDANCE } from './instructions.ts';

interface McpOptions {
  scopes: string[];
  events?: (method: string, args: Record<string, unknown>) => Promise<object>;
  connections: () => Promise<object>;
  invoke: (operation: GatewayOperation, args: Record<string, unknown>) => Promise<object>;
}
function createServer({ invoke, connections, scopes, events }: McpOptions) {
  const capabilities = { tools: {}, ...(events ? { events: {} } : {}) };
  const server = new McpServer(
    { name: 'dotx-remote', title: 'DotX Remote', version: packageInfo.version },
    {
      instructions: GATEWAY_INSTRUCTIONS,
      capabilities,
      supportedProtocolVersions: [MCP_PROTOCOL_VERSION],
    },
  );
  if (events) {
    const schemas = {
      'events/list': z.object({ cursor: z.string().optional() }),
      'events/subscribe': subscribeSchema,
      'events/unsubscribe': unsubscribeSchema,
    };
    for (const [name, params] of Object.entries(schemas))
      server.server.setRequestHandler(name, { params }, async (args) => {
        if (!scopes.includes('mcp:read')) throw new ProtocolError(-32602, 'INSUFFICIENT_SCOPE');
        try {
          return { ...(await events(name, args)) };
        } catch (e) {
          if (e && typeof e === 'object' && 'code' in e && e.code === -32015)
            throw new ProtocolError(
              -32015,
              'CallbackEndpointError',
              'data' in e ? e.data : undefined,
            );
          throw new ProtocolError(-32602, errorCode(e) ?? 'INVALID_EVENT_ARGUMENTS');
        }
      });
  }
  function register<S extends z.ZodRawShape>(
    name: string,
    description: string,
    schema: S,
    handler: (args: z.output<z.ZodObject<S>>) => Promise<object>,
    write = false,
  ) {
    const inputSchema = z.strictObject(schema);
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        annotations: {
          readOnlyHint: !write,
          destructiveHint: write,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args) => {
        let value;
        try {
          if (!scopes.includes('mcp:read') || (write && !scopes.includes('mcp:write')))
            throw Object.assign(new Error('Authorization lacks required scope'), {
              code: 'INSUFFICIENT_SCOPE',
            });
          value = await handler(args);
          return {
            content: [{ type: 'text', text: JSON.stringify(value) }],
            structuredContent: { ...value },
          };
        } catch (e) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: {
                    code: errorCode(e) || 'BRIDGE_ERROR',
                    message: e instanceof Error ? e.message : 'Bridge error',
                  },
                }),
              },
            ],
          };
        }
      },
    );
  }
  register(
    'list_connections',
    'List authorized connections, availability and interface runtime IDs. Includes service metadata for joining another Mac, running versions, a cached latest-release hint and guidance on reading DotX instructions.',
    {},
    async () => ({ ...(await connections()), instructions: INSTRUCTIONS_GUIDANCE }),
  );
  register(
    'get_instructions',
    `Read DotX usage instructions. ${INSTRUCTIONS_GUIDANCE}`,
    {},
    async () => ({ instructions: GATEWAY_INSTRUCTIONS }),
  );
  register(
    'describe_methods',
    'List native methods for an interface; supply method to get its full input/output schemas.',
    gatewaySchemas.describe_methods.shape,
    (args) => invoke('describe_methods', args),
  );
  register(
    'call',
    'Call a native method and return its raw RPC result/error in native. request_id deduplicates execution; ordinary RPC payloads are not retained. tracking=thread_turn supports App Tools send_message_to_thread and returns the dispatch receipt while its turn is tracked.',
    gatewaySchemas.call.shape,
    (args) => invoke('call', args),
    true,
  );
  register(
    'get_request',
    'Read execution state and any tracked-turn receipt for request_id. Ordinary RPC payloads are available only in the original call response. RPC returned is not task completion.',
    gatewaySchemas.get_request.shape,
    (args) => invoke('get_request', args),
  );
  register(
    'read_events',
    'Read a runtime event page. Webhook read_cursor points here; server_request events include the response_schema for respond.',
    gatewaySchemas.read_events.shape,
    (args) => invoke('read_events', args),
  );
  register(
    'respond',
    'Answer an observed server_request using its response_schema. The original event fixes the route; repeated identical answers are deduplicated.',
    gatewaySchemas.respond.shape,
    (args) => invoke('respond', args),
    true,
  );
  return server;
}

export async function serveMcp(request: Request, options: McpOptions) {
  // Subscription storage and delivery belong to the host, beyond this MCP request.
  const handler = createMcpHandler(() => createServer(options), {
    legacy: 'reject',
    maxRequestBodySize: 1024 * 1024,
  });
  try {
    return await handler.fetch(request);
  } finally {
    await handler.close();
  }
}
