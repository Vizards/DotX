import net from 'node:net';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { BridgeError, errorCode } from '@dotx/shared/errors';
const toolSchema = z
  .object({
    namespace: z.string(),
    name: z.string(),
    // The native interface owns JSON Schema dialects and argument validation.
    inputSchema: z.unknown().optional(),
  })
  .passthrough();
type ToolSchema = z.infer<typeof toolSchema>['inputSchema'];
const rpcReply = z.object({
  id: z.string(),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number(), message: z.string(), data: z.unknown().optional() })
    .optional(),
});
export interface NativeClient {
  call(tool: string, args: Record<string, unknown>, context?: { turnId: string }): Promise<unknown>;
}
export class NativeRpcError extends BridgeError {
  readonly native: { code: number; message: string; data?: unknown };
  constructor(error: { code: number; message: string; data?: unknown }) {
    super('DESKTOP_RPC_ERROR', error.message);
    this.native = error;
  }
}
type Rpc = typeof pipeRpc;
export interface RpcObservation {
  startedAt: number;
  operation: string;
  phase: 'connecting' | 'awaiting_response' | 'receiving_response' | 'complete';
  elapsedMs: number;
  timeoutMs: number;
  receivedBytes: number;
  outcome: string;
}
type ObserveRpc = (observation: RpcObservation) => void;

// PRIVATE CODEX API: the desktop-injected App Tools pipe uses length-prefixed JSON-RPC.
// Despite tools/list and tools/call names, its framing and envelopes are not public MCP.
// A desktop update can change either independently of the discovered tool schemas.
// Never discover another process's pipe or credentials.
export function pipeRpc(
  pipe: string | undefined,
  method: string,
  params: unknown,
  timeoutMs = 15000,
  observe?: ObserveRpc,
): Promise<unknown> {
  if (!pipe) return Promise.reject(new BridgeError('DESKTOP_PIPE_MISSING'));
  return new Promise((resolve, reject) => {
    const id = randomUUID(),
      socket = net.createConnection(pipe);
    let data = Buffer.alloc(0),
      done = false;
    const startedAt = Date.now();
    const start = performance.now();
    const tool = params && typeof params === 'object' && 'tool' in params ? params.tool : null;
    const operation =
      typeof tool === 'string' &&
      ['list_threads', 'read_thread', 'send_message_to_thread'].includes(tool)
        ? tool
        : method;
    let phase: RpcObservation['phase'] = 'connecting';
    const finish = (error: unknown, result?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      try {
        observe?.({
          startedAt,
          operation,
          phase: error ? phase : 'complete',
          elapsedMs: Math.round(performance.now() - start),
          timeoutMs,
          receivedBytes: data.length,
          outcome: error ? errorCode(error) || 'INTERNAL_ERROR' : 'ok',
        });
      } catch {
        // Diagnostics must never change a send result or trigger a second dispatch.
      }
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish(
          new BridgeError(
            'DESKTOP_TIMEOUT',
            `Desktop ${operation} timed out after ${Math.round(performance.now() - start)}ms (${phase}, receivedBytes=${data.length})`,
          ),
        ),
      timeoutMs,
    );
    socket.once('connect', () => {
      phase = 'awaiting_response';
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on('data', (chunk) => {
      phase = 'receiving_response';
      data = Buffer.concat([data, chunk]);
      if (data.length < 4) return;
      const size = data.readUInt32LE();
      if (size > 16 * 1024 * 1024) return finish(new BridgeError('DESKTOP_FRAME_TOO_LARGE'));
      if (data.length < size + 4) return;
      try {
        const reply = rpcReply.parse(JSON.parse(data.subarray(4, size + 4).toString('utf8')));
        if (reply.id !== id) throw new BridgeError('DESKTOP_RESPONSE_MISMATCH');
        if (reply.error) throw new NativeRpcError(reply.error);
        finish(null, reply.result);
      } catch (e) {
        finish(e);
      }
    });
    socket.once('error', (e) =>
      finish(
        new BridgeError('DESKTOP_DISCONNECTED', `Desktop pipe error: ${errorCode(e) || 'unknown'}`),
      ),
    );
    socket.once('close', () => finish(new BridgeError('DESKTOP_DISCONNECTED')));
  });
}

export class Native {
  readonly pipe: string | undefined;
  readonly callerThreadId: string;
  readonly rpc: Rpc;
  readonly observeRpc?: ObserveRpc;
  schemas?: Map<string, ToolSchema>;
  private discovery?: ReturnType<Native['discoverCapabilities']>;
  constructor({
    pipe,
    callerThreadId,
    rpc = pipeRpc,
    observeRpc,
  }: {
    pipe?: string;
    callerThreadId: string;
    rpc?: Rpc;
    observeRpc?: ObserveRpc;
  }) {
    this.pipe = pipe;
    this.callerThreadId = callerThreadId;
    this.rpc = rpc;
    this.observeRpc = observeRpc;
  }
  capabilities() {
    // One discovery per desktop connection lifetime; concurrent probes share it.
    // Failed discovery is retried. RPC failures invalidate it without replaying a call.
    return (this.discovery ??= this.discoverCapabilities().catch((error: unknown) => {
      this.discovery = undefined;
      throw error;
    }));
  }
  private async discoverCapabilities() {
    const parsed = z
      .object({ tools: z.array(toolSchema) })
      .safeParse(
        await this.rpc(this.pipe, 'tools/list', { threadStartKind: 'all' }, 15000, this.observeRpc),
      );
    if (!parsed.success) throw new BridgeError('UNSUPPORTED_CAPABILITY_SCHEMA');
    const result = parsed.data;
    // Exact shape is recorded by diagnostics; do not silently assume an unknown schema.
    const entries = result.tools;
    if (!entries.length) throw new BridgeError('NATIVE_METHOD_CATALOG_EMPTY');
    this.schemas = new Map(entries.map((t) => [`${t.namespace}.${t.name}`, t.inputSchema]));
    return {
      protocol: 1,
      tools: entries.map((t) => `${t.namespace}.${t.name}`),
      schemaDigestSource: entries,
    };
  }
  async rawCall(
    method: string,
    args: Record<string, unknown>,
    context?: { turnId: string },
  ): Promise<unknown> {
    if (!this.schemas) await this.capabilities();
    if (!this.schemas?.has(method)) throw new BridgeError('NATIVE_METHOD_NOT_FOUND', method);
    const split = method.indexOf('.');
    const namespace = method.slice(0, split),
      tool = method.slice(split + 1);
    // Private caller envelope: threadId is our archived caller, not the target thread.
    // Target host/thread stay in arguments; changing this routing can execute in the wrong context.
    return this.rpc(
      this.pipe,
      'tools/call',
      {
        arguments: args,
        callerSource: 'codex',
        callId: randomUUID(),
        hostId: 'local',
        namespace,
        threadId: this.callerThreadId,
        tool,
        // Tracked sends use the DO's pre-reserved ID. The desktop records it as
        // parent_turn_id on the target, outside the prompt. This is not native deduplication.
        turnId: context?.turnId ?? randomUUID(),
      },
      30000,
      this.observeRpc,
    );
  }
  async call(
    tool: string,
    args: Record<string, unknown>,
    context?: { turnId: string },
  ): Promise<unknown> {
    let raw: unknown;
    try {
      raw = await this.rawCall(`codex_app.${tool}`, args, context);
    } catch (error) {
      this.schemas = undefined;
      this.discovery = undefined;
      throw error;
    }
    // Private App Tools result wrapper, used by health checks and exact-turn tracking.
    // Generic app_tools calls retain the raw result; this parser must be rechecked if it changes.
    const result = z
      .object({
        success: z.boolean(),
        contentItems: z.array(z.object({ text: z.string().optional() }).passthrough()).optional(),
      })
      .safeParse(raw);
    if (!result.success || result.data.success !== true)
      throw new BridgeError('DESKTOP_TOOL_FAILED');
    for (const item of result.data.contentItems || []) {
      if (typeof item.text === 'string') {
        try {
          return JSON.parse(item.text);
        } catch {}
      }
    }
    throw new BridgeError('UNSUPPORTED_TOOL_RESPONSE');
  }
}
