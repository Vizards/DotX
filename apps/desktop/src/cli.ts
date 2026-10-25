import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { cliDataDir } from './local/paths.ts';
import { readConfig, type DeviceConfig } from './local/config.ts';
import { identity } from './local/identity.ts';
import { tryLock } from './local/locks.ts';
import { writeJson } from './local/files.ts';
import { readOwner } from './local/ipc.ts';
import { serviceInfo } from './connection/service.ts';
import { enroll } from './connection/enrollment.ts';
import { bootstrap } from './interfaces/caller.ts';
import { displayName } from '@dotx/shared/http/enrollment';
import { errorCode } from '@dotx/shared/errors';
import packageInfo from '../package.json' with { type: 'json' };
process.umask(0o077);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { state: { type: 'string' }, url: { type: 'string' }, name: { type: 'string' } },
});
async function main() {
  const dir = cliDataDir(values.state),
    command = positionals[0] ?? 'status';
  if (command === 'status') {
    const config = readConfig(dir);
    let owner: unknown = null;
    try {
      process.chdir(dir);
      owner = await readOwner(dir);
    } catch {}
    return {
      version: packageInfo.version,
      data_dir: dir,
      configured: !!config,
      target_server: config?.service.origin ?? null,
      device_id: config?.deviceId ?? null,
      owner,
    };
  }
  if (command !== 'connect' || !values.url)
    throw new Error(
      'Usage: cli.mjs status --state HOST_PLUGIN_DATA | connect --state HOST_PLUGIN_DATA --url HTTPS_ORIGIN [--name NAME]',
    );
  const release = tryLock(dir, 'installation.lock');
  if (!release) throw new Error('INSTALLATION_BUSY');
  try {
    process.chdir(dir);
    const service = await serviceInfo(values.url),
      keys = identity(dir, true);
    let config = readConfig(dir);
    if (config) {
      if (
        config.service.origin !== service.origin ||
        config.service.service_id !== service.service_id
      )
        throw new Error('DEVICE_SERVICE_CHANGE_REQUIRES_RESET');
      if (config.keyId !== keys.keyId) throw new Error('DEVICE_KEY_MISMATCH');
    } else {
      config = {
        deviceId: randomUUID(),
        label: displayName.parse(values.name ?? os.hostname()),
        keyId: keys.keyId,
        operationId: randomUUID(),
        service,
      } satisfies DeviceConfig;
      writeJson(path.join(dir, 'config.json'), config);
    }
    const ready = await bootstrap(dir);
    let application = await enroll(ready, keys.publicKey);
    if (['expired', 'rejected', 'revoked'].includes(application.status)) {
      ready.operationId = randomUUID();
      writeJson(path.join(dir, 'config.json'), ready);
      application = await enroll(ready, keys.publicKey);
    }
    if (ready.operationId !== application.operation_id) {
      ready.operationId = application.operation_id;
      writeJson(path.join(dir, 'config.json'), ready);
    }
    return {
      version: packageInfo.version,
      data_dir: dir,
      device_id: ready.deviceId,
      target_server: service.origin,
      application,
      next_action:
        'Refresh the host MCP configuration, then call device_status to verify the actual owner and target connection. ' +
        (application.status === 'approved'
          ? 'This device is already approved; no new approval is needed.'
          : 'Approve this application through the Server management page or an authorized Wrangler management tool.'),
      guide_url: service.guides_url.replace('index.md', 'codex/connect.md'),
    };
  } finally {
    release();
  }
}
try {
  console.log(JSON.stringify(await main()));
} catch (error) {
  console.error(
    JSON.stringify({
      error: {
        code: errorCode(error) ?? (error instanceof Error ? error.message : 'LOCAL_SETUP_FAILED'),
        message: error instanceof Error ? error.message : 'Local setup failed',
      },
    }),
  );
  process.exitCode = 1;
}
