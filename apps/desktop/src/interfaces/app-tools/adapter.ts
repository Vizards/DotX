import { NativeError } from '@dotx/shared/errors';
import { randomUUID } from 'node:crypto';
import { Native } from './transport.ts';
import type { Adapter, Method } from '../adapter.ts';
import type { Call, NativeResponse } from '@dotx/shared/wire/commands';
import type { InterfaceStatus } from '@dotx/shared/devices';
export class AppToolsAdapter implements Adapter {
  readonly runtimeId = randomUUID();
  ready = false;
  constructor(readonlyOptions: { native: Native; version: string }) {
    this.native = readonlyOptions.native;
    this.version = readonlyOptions.version;
  }
  readonly native: Native;
  readonly version: string;
  status(): InterfaceStatus {
    return {
      name: 'app_tools',
      runtime_id: this.runtimeId,
      availability: this.ready ? 'online' : 'unavailable',
      version: this.version,
    };
  }
  async methods(): Promise<Method[]> {
    const c = await this.native.capabilities();
    return c.toolDefinitions.map((x) => ({
      name: `${x.namespace}.${x.name}`,
      description: x.description as string | undefined,
      annotations: x.annotations,
      input_schema: x.inputSchema,
      output_schema: x.outputSchema,
      kind: 'request',
      tracking:
        x.namespace === 'codex_app' && x.name === 'send_message_to_thread'
          ? ['native', 'thread_turn']
          : ['native'],
    }));
  }
  async call(method: string, params: Call['params']): Promise<NativeResponse> {
    try {
      return { result: await this.native.rawCall(method, params) };
    } catch (e) {
      if (e instanceof NativeError) return { error: e.value };
      throw e;
    }
  }
  close() {}
}
