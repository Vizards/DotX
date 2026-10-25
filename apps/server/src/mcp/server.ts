import { subscribeSchema, unsubscribeSchema } from '../events/catalog.ts';
import { McpServer, createMcpHandler, ProtocolError } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { gatewaySchemas } from './schemas.ts';
import type { GatewayOperation } from './schemas.ts';
import { errorCode, errorValue } from '@dotx/shared/errors';
import packageInfo from '../../package.json' with { type: 'json' };
import branding from '../../public/branding/metadata.json' with { type: 'json' };
import { getInstructions, INSTRUCTION_GUIDES, INSTRUCTIONS_GUIDANCE } from './guides.ts';
import type { InstructionGoal } from './guides.ts';

interface McpOptions {
  publicOrigin: string;
  events: (method: string, args: Record<string, unknown>) => Promise<object>;
  connections: () => Promise<object>;
  invoke: (operation: GatewayOperation, args: Record<string, unknown>) => Promise<object>;
}
function createServer({ invoke, connections, events, publicOrigin }: McpOptions) {
  const capabilities = { tools: {}, events: {} };
  const server = new McpServer(
    {
      ...branding,
      version: packageInfo.version,
      icons: [
        {
          src: new URL('/branding/icon.png', publicOrigin).href,
          mimeType: 'image/png',
          sizes: ['256x256'],
        },
      ],
    },
    {
      instructions: INSTRUCTIONS_GUIDANCE,
      capabilities,
    },
  );
  const schemas = {
    'events/list': z.object({ cursor: z.string().optional() }),
    'events/subscribe': subscribeSchema,
    'events/unsubscribe': unsubscribeSchema,
  };
  for (const [name, params] of Object.entries(schemas))
    server.server.setRequestHandler(name, { params }, async (args) => {
      try {
        return { ...(await events(name, args)) };
      } catch (e) {
        if (e && typeof e === 'object' && 'code' in e && e.code === -32015)
          throw new ProtocolError(
            -32015,
            'CallbackEndpointError',
            'data' in e ? e.data : undefined,
          );
        throw new ProtocolError(-32602, errorCode(e) ?? 'INVALID_EVENT_ARGUMENTS', errorValue(e));
      }
    });
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
        description:
          name === 'get_instructions' ? description : `${description}\n\n${INSTRUCTIONS_GUIDANCE}`,
        inputSchema,
        annotations: {
          readOnlyHint: !write,
          destructiveHint: write,
          idempotentHint: name !== 'call',
          openWorldHint: true,
        },
      },
      async (args) => {
        let value;
        try {
          value = await handler(args);
          return {
            content: [{ type: 'text', text: JSON.stringify(value) }],
          };
        } catch (e) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: errorValue(e),
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
    'List authorized connections, availability and interface runtime IDs. Includes service metadata for joining another Mac, running versions and a cached latest-release hint.',
    {},
    connections,
  );
  register(
    'get_instructions',
    'Read DotX guidance for a task goal. Omit goal to list guides and when to use them; pass a goal from the directory to read only that guide.',
    {
      goal: z
        .enum(Object.keys(INSTRUCTION_GUIDES) as [InstructionGoal, ...InstructionGoal[]])
        .optional(),
    },
    async ({ goal }) => getInstructions(goal),
  );
  register(
    'describe_methods',
    'List native methods for an interface; supply method to get its full input/output schemas.',
    gatewaySchemas.describe_methods.shape,
    (args) => invoke('describe_methods', args),
  );
  register(
    'call',
    'Call a native method and return its raw RPC result/error in native. Omit request_id for ordinary read-only queries: no durable receipt or deduplication. Provide request_id for side effects or uncertain methods to persist deduplication and enable get_request; RPC payloads are not retained. tracking=thread_turn requires request_id and supports App Tools send_message_to_thread for exact-turn receipts.',
    gatewaySchemas.call.shape,
    (args) => invoke('call', args),
    true,
  );
  register(
    'get_request',
    'Read execution state and any tracked-turn receipt for a call made with request_id, including after missing or interrupted notifications. expires_at is its retention deadline; after cleanup REQUEST_NOT_FOUND does not prove the task failed or authorize resending it. Calls without request_id have no stored receipt. Ordinary RPC payloads are available only in the original call response. RPC returned is not task completion.',
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
  const handler = createMcpHandler(() => createServer(options));
  try {
    return await handler.fetch(request);
  } finally {
    await handler.close();
  }
}
