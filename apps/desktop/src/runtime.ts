import path from 'node:path';
import { readConfig, validateConfig, type ReadyConfig } from './local/config.ts';
import { identity } from './local/identity.ts';
import { tryLock } from './local/locks.ts';
import { nextGeneration } from './local/connector-state.ts';
import { serveStatus, readOwner } from './local/ipc.ts';
import { startDevice } from './native.ts';
import { errorValue } from '@dotx/shared/errors';
import packageInfo from '../package.json' with { type: 'json' };
type OwnerStatus = Partial<ReturnType<ReturnType<typeof startDevice>['status']>>;
export class Runtime {
  readonly dir: string;
  readonly root: string;
  config: ReadyConfig | null = null;
  role: 'unconfigured' | 'standby' | 'owner' | 'unavailable' = 'unconfigured';
  diagnostic: unknown = { code: 'SETUP_REQUIRED' };
  native: ReturnType<typeof startDevice> | undefined;
  starting: Promise<void> | undefined;
  stopped = false;
  release: (() => void) | undefined;
  closeIpc: (() => Promise<void>) | undefined;
  constructor(dir: string, root: string) {
    this.dir = dir;
    this.root = root;
    try {
      const config = readConfig(dir);
      if (config) {
        validateConfig(config);
        this.config = config;
        this.role = 'standby';
        this.diagnostic = null;
      }
    } catch (error) {
      this.role = 'unavailable';
      this.diagnostic = errorValue(error);
    }
  }
  start() {
    if (this.stopped || this.starting || this.native || !this.config) return;
    this.starting = this.startOwner().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
  private async startOwner() {
    try {
      const release = tryLock(this.dir, 'connector.lock');
      if (!release) return;
      this.release = release;
      const keys = identity(this.dir);
      if (keys.keyId !== this.config!.keyId) throw new Error('DEVICE_KEY_MISMATCH');
      const generation = nextGeneration(this.dir);
      this.closeIpc = await serveStatus(
        this.dir,
        () =>
          this.native?.status() ?? {
            state: 'initializing',
            version: packageInfo.version,
            pid: process.pid,
          },
      );
      if (this.stopped) return;
      this.native = startDevice(this.dir, this.config!, keys, generation);
      this.role = 'owner';
      this.diagnostic = null;
    } catch (error) {
      this.diagnostic = errorValue(error);
      this.role = 'unavailable';
      this.config = null;
      try {
        await this.closeIpc?.();
      } finally {
        this.closeIpc = undefined;
        this.release?.();
        this.release = undefined;
      }
      process.stderr.write(
        JSON.stringify({ code: 'CONNECTOR_START_FAILED', cause: this.diagnostic }) + '\n',
      );
    }
  }
  async status(): Promise<object> {
    const entry = {
      role: this.role,
      pid: process.pid,
      version: packageInfo.version,
      diagnostic: this.diagnostic,
    };
    let owner: OwnerStatus | null = this.native?.status() ?? null,
      diagnostic = this.diagnostic;
    // An entry loaded before setup can still observe an owner started after refresh.
    // Querying status does not reload this entry's config or start a connection.
    if (!this.native) {
      try {
        owner = (await readOwner(this.dir)) as OwnerStatus;
        diagnostic = null;
      } catch (error) {
        if (this.role === 'standby')
          diagnostic = { code: 'OWNER_STATUS_UNAVAILABLE', cause: errorValue(error) };
      }
    }
    return {
      entry,
      data_dir: this.dir,
      docs_dir: path.join(this.root, 'docs'),
      target_server: owner?.target_server ?? this.config?.service.origin ?? null,
      device_id: owner?.deviceId ?? this.config?.deviceId ?? null,
      owner,
      diagnostic,
    };
  }
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    await this.starting;
    try {
      await this.native?.stop();
    } finally {
      try {
        await this.closeIpc?.();
      } finally {
        this.closeIpc = undefined;
        this.release?.();
        this.release = undefined;
      }
    }
  }
}
