import { z } from 'zod';
import { id } from '@dotx/shared/requests';
import { deviceRequestSchemas } from '@dotx/shared/wire/commands';

export const gatewaySchemas = {
  describe_methods: deviceRequestSchemas.describe_methods,
  call: deviceRequestSchemas.call.extend({
    request_id: id
      .optional()
      .describe(
        'Provide for durable deduplication and get_request; required for thread_turn tracking. Omit for ordinary read-only queries.',
      ),
  }),
  get_request: z.strictObject({ request_id: id }),
  read_events: deviceRequestSchemas.read_events,
  respond: z.strictObject({
    event_id: id,
    response: z.union([
      z.strictObject({ result: z.unknown() }),
      z.strictObject({
        error: z.object({
          code: z.number().int(),
          message: z.string(),
          data: z.unknown().optional(),
        }),
      }),
    ]),
  }),
};
export type GatewayOperation = keyof typeof gatewaySchemas;
