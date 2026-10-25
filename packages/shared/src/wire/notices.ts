import { z } from 'zod';
import { interfaceName } from '../devices.ts';
const id = z.string().min(1);
export const eventName = z.enum(['gateway.request.updated', 'gateway.native.event']);
const base = { connection_id: id };
export const noticeData = z.strictObject({
  ...base,
  interface: interfaceName,
  runtime_id: id,
  request_id: id.optional(),
  tracking: z.enum(['native', 'thread_turn']).optional(),
  rpc_status: z.string().optional(),
  status: z.string().optional(),
  host_id: id.optional(),
  thread_id: id.optional(),
  turn_id: id.optional(),
  source_event_id: id.optional(),
  read_cursor: z.string().optional(),
  kind: z.enum(['notification', 'server_request', 'lifecycle']).optional(),
  method: z.string().optional(),
  interaction_key: id.optional(),
});
export type NoticeData = z.infer<typeof noticeData>;
export const notice = z.strictObject({
  eventId: id,
  name: eventName,
  timestamp: z.iso.datetime({ offset: true }),
  data: noticeData,
});
export type Notice = z.infer<typeof notice>;
