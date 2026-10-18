import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BridgeError, errorCode } from '@dotx/shared/errors';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import type { InterfaceStatus, NativeResponse, NativeEvent } from '@dotx/shared/gateway';
import type { Adapter, Method } from '../adapter.ts';
import { readNativeCatalog } from './schema.ts';
import packageInfo from '../../../package.json' with { type: 'json' };
export class AppServerAdapter implements Adapter {
  readonly runtimeId = randomUUID();
  readonly process: ChildProcessWithoutNullStreams;
  readonly pending = new Map<
    string,
    {
      resolve: (v: NativeResponse) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly catalog: Method[];
  readonly catalogReady: boolean;
  ready = false;
  ended = false;
  diagnostic: string | undefined;
  readonly initialized: Promise<void>;
  readonly exited: Promise<void>;
  constructor(options: {
    cli: string;
    home: string;
    cwd: string;
    log: string;
    version: string;
    onEvent: (native: Record<string, unknown>, responseSchema?: unknown) => void;
    onExit: (runtime: string) => void;
  }) {
    this.version = options.version;
    this.catalog = [];
    this.catalogReady = false;
    try {
      this.catalog = readNativeCatalog(options.cli);
      this.catalogReady = true;
    } catch {
      this.diagnostic = 'APP_SERVER_SCHEMA_GENERATION_FAILED';
    }
    const catalogReady = this.catalogReady;
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('CODEX_')),
    );
    env.CODEX_HOME = options.home;
    this.process = spawn(options.cli, ['app-server', '--listen', 'stdio://'], {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const log = fs.createWriteStream(options.log, { flags: 'a', mode: 0o600 });
    this.process.stderr.pipe(log);
    readline.createInterface({ input: this.process.stdout }).on('line', (line) => {
      try {
        const m = JSON.parse(line) as Record<string, any>;
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
      } catch {
        this.diagnostic = 'INVALID_APP_SERVER_MESSAGE';
        void this.close();
      }
    });
    let finishExit!: () => void;
    this.exited = new Promise<void>((resolve) => {
      finishExit = resolve;
    });
    const exit = () => {
      if (this.ended) return;
      this.ended = true;
      this.ready = false;
      this.diagnostic ??= 'APP_SERVER_EXITED';
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new BridgeError('APP_SERVER_EXITED'));
      }
      this.pending.clear();
      options.onExit(this.runtimeId);
      log.end();
      finishExit();
    };
    this.process.stdin.on('error', () => {
      this.diagnostic = 'APP_SERVER_PIPE_FAILED';
      this.process.kill('SIGTERM');
    });
    log.on('error', () => {
      this.diagnostic = 'APP_SERVER_LOG_FAILED';
    });
    this.process.on('error', exit);
    this.process.on('exit', exit);
    this.initialized = (async () => {
      const reply = await this.call('initialize', {
        clientInfo: { name: 'dotx-desktop', version: packageInfo.version },
        capabilities: { experimentalApi: true },
      });
      if (reply.error) throw new BridgeError('APP_SERVER_INITIALIZE_FAILED', reply.error.message);
      this.write({ method: 'initialized', params: {} });
      this.ready = catalogReady;
    })();
    void this.initialized.catch((error) => {
      this.diagnostic =
        errorCode(error) === 'APP_SERVER_TIMEOUT'
          ? 'APP_SERVER_INITIALIZE_TIMEOUT'
          : 'APP_SERVER_INITIALIZE_FAILED';
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
      diagnostic: this.diagnostic ? { code: this.diagnostic } : null,
    };
  }
  async methods() {
    await this.initialized;
    if (!this.catalogReady) throw new BridgeError('APP_SERVER_SCHEMA_GENERATION_FAILED');
    return this.catalog;
  }
  write(m: unknown) {
    if (this.ended) throw new BridgeError('APP_SERVER_EXITED');
    this.process.stdin.write(JSON.stringify(m) + '\n');
  }
  call(method: string, params: Record<string, unknown>): Promise<NativeResponse> {
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
