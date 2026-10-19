import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import readline from 'node:readline';
import type { Writable, Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { BridgeError, errorCode, errorValue } from '@dotx/shared/errors';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import type { Call, InterfaceStatus, NativeResponse, NativeEvent } from '@dotx/shared/gateway';
import type { Adapter, Method } from '../adapter.ts';
import { readNativeCatalog } from './schema.ts';
import packageInfo from '../../../package.json' with { type: 'json' };
export class AppServerAdapter implements Adapter {
  readonly runtimeId = randomUUID();
  readonly process: ChildProcessByStdio<Writable, Readable, null>;
  readonly pending = new Map<
    string,
    {
      resolve: (v: NativeResponse) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly catalog: Method[];
  ready = false;
  ended = false;
  diagnostic: unknown;
  readonly catalogError?: unknown;
  readonly initialized: Promise<void>;
  readonly exited: Promise<void>;
  constructor(options: {
    cli: string;
    home: string;
    cwd: string;
    version: string;
    onEvent: (native: Record<string, unknown>, responseSchema?: unknown) => void;
    onExit: (runtime: string) => void;
  }) {
    this.version = options.version;
    this.catalog = [];
    try {
      this.catalog = readNativeCatalog(options.cli);
    } catch (error) {
      this.catalogError = error;
    }
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('CODEX_')),
    );
    env.CODEX_HOME = options.home;
    this.process = spawn(options.cli, ['app-server', '--listen', 'stdio://'], {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    readline.createInterface({ input: this.process.stdout }).on('line', (line) => {
      let m: Record<string, any>;
      try {
        m = JSON.parse(line);
      } catch (cause) {
        this.diagnostic = new BridgeError('INVALID_APP_SERVER_MESSAGE', undefined, { cause });
        void this.close();
        return;
      }
      try {
        if (m.method) {
          const schema =
            m.id !== undefined
              ? this.catalog.find((x) => x.kind === 'server_request' && x.name === m.method)
                  ?.output_schema
              : undefined;
          options.onEvent(m, schema);
        } else {
          const p = this.pending.get(String(m.id));
          if (p) {
            this.pending.delete(String(m.id));
            clearTimeout(p.timer);
            p.resolve(m.error ? { error: m.error } : { result: m.result });
          }
        }
      } catch (cause) {
        this.diagnostic = new BridgeError('APP_SERVER_MESSAGE_HANDLING_FAILED', undefined, {
          cause,
        });
        void this.close();
      }
    });
    let finishExit!: () => void;
    this.exited = new Promise<void>((resolve) => {
      finishExit = resolve;
    });
    const exit = (error: Error) => {
      if (this.ended) return;
      this.ended = true;
      this.ready = false;
      this.diagnostic ??= error;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new BridgeError('APP_SERVER_EXITED', undefined, { cause: this.diagnostic }));
      }
      this.pending.clear();
      options.onExit(this.runtimeId);
      finishExit();
    };
    this.process.stdin.on('error', (cause) => {
      this.diagnostic = new BridgeError('APP_SERVER_PIPE_FAILED', undefined, { cause });
      this.process.kill('SIGTERM');
    });
    this.process.on('error', (cause) =>
      exit(new BridgeError('APP_SERVER_START_FAILED', undefined, { cause })),
    );
    this.process.on('exit', (exitCode, signal) =>
      exit(new BridgeError('APP_SERVER_EXITED', undefined, { cause: { exitCode, signal } })),
    );
    this.initialized = (async () => {
      const reply = await this.call('initialize', {
        clientInfo: { name: 'dotx-desktop', version: packageInfo.version },
        capabilities: { experimentalApi: true },
      });
      if ('error' in reply) throw reply.error;
      this.write({ method: 'initialized', params: {} });
      this.ready = true;
    })();
    void this.initialized.catch((error) => {
      this.diagnostic = new BridgeError(
        errorCode(error) === 'APP_SERVER_TIMEOUT'
          ? 'APP_SERVER_INITIALIZE_TIMEOUT'
          : 'APP_SERVER_INITIALIZE_FAILED',
        undefined,
        { cause: error },
      );
      void this.close();
    });
  }
  readonly version: string;
  status(): InterfaceStatus {
    return {
      name: 'app_server',
      runtime_id: this.runtimeId,
      availability: this.ready ? 'online' : 'unavailable',
      version: this.version,
      diagnostic: errorValue(this.diagnostic ?? this.catalogError) ?? null,
    };
  }
  async methods() {
    await this.initialized;
    if (this.catalogError !== undefined) throw this.catalogError;
    return this.catalog;
  }
  write(m: unknown) {
    if (this.ended)
      throw new BridgeError('APP_SERVER_EXITED', undefined, { cause: this.diagnostic });
    this.process.stdin.write(JSON.stringify(m) + '\n');
  }
  call(method: string, params: Call['params']): Promise<NativeResponse> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      // JSON-RPC over stdio has no response deadline. Expiry releases this waiter;
      // it does not cancel the native operation or permit a duplicate dispatch.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BridgeError(
            'APP_SERVER_TIMEOUT',
            `No response to ${method}; reconcile, do not resend`,
          ),
        );
      }, DEFAULT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  respond(event: NativeEvent, response: NativeResponse) {
    this.write({ id: event.native.id, ...response });
  }
  async close() {
    if (this.ended) return;
    this.process.stdin.end();
    const t = setTimeout(() => this.process.kill('SIGTERM'), DEFAULT_TIMEOUT_MS);
    t.unref();
    await this.exited;
    clearTimeout(t);
  }
}
