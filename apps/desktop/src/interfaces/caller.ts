import { BridgeError } from '@dotx/shared/errors';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { privateDir, readJson, writeJson } from '../local/files.ts';
import { validateConfig, type DeviceConfig } from '../local/config.ts';
import { discoverDesktop } from './host.ts';
import { AppServer } from './app-server/process.ts';

const threadReply = z.object({ thread: z.object({ id: z.string() }) });

export async function bootstrap(
  dir: string,
  {
    desktop = discoverDesktop(),
    home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  } = {},
) {
  privateDir(dir);
  privateDir(path.join(dir, 'caller-workspace'));
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'config.json');
  const config = readJson<DeviceConfig>(file);
  delete config.callerCreationPending; // Discard the obsolete development-install marker.
  const client = new AppServer(desktop.cli, home, path.join(dir, 'caller-workspace'));
  try {
    if (config.callerThreadId) validateConfig(config as DeviceConfig);
    await client.initialize();
    if (config.callerThreadId) {
      const r = threadReply.parse(
        await client.call('thread/read', { threadId: config.callerThreadId }),
      );
      if (r.thread?.id !== config.callerThreadId) throw new BridgeError('CALLER_INVALID');
      if (config.codexHome && config.codexHome !== home)
        throw new BridgeError('CALLER_HOME_MISMATCH');
    } else {
      // If setup lost the previous ID, another empty caller is acceptable.
      // The device identity and enrollment remain unchanged.
      const r = threadReply.parse(
        await client.call('thread/start', {
          cwd: path.join(dir, 'caller-workspace'),
          approvalPolicy: 'never',
          sandbox: 'read-only',
          ephemeral: false,
        }),
      );
      if (!r.thread?.id) throw new BridgeError('CALLER_CREATE_FAILED');
      Object.assign(config, {
        callerThreadId: r.thread.id,
        callerArchived: false,
        codexHome: home,
      });
      writeJson(file, config); // Recover the same caller if naming/archive fails.
    }
    if (!config.callerArchived) {
      await client.call('thread/name/set', {
        threadId: config.callerThreadId,
        name: 'DotX Desktop · caller (archived)',
      });
      await client.call('thread/archive', { threadId: config.callerThreadId });
    }
    if (!config.callerThreadId) throw new BridgeError('CALLER_CREATE_FAILED');
    const installed: DeviceConfig = {
      ...config,
      callerThreadId: config.callerThreadId,
      callerArchived: true,
      codexHome: home,
    };
    writeJson(file, installed);
    validateConfig(installed);
    return installed;
  } finally {
    client.close();
  }
}
