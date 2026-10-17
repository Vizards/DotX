import { BridgeError } from '@dotx/shared/errors';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { privateDir, readJson, writeJson } from '../runtime/state.ts';
import { validateConfig, type DeviceConfig } from '../runtime/config.ts';
import { discoverDesktop } from '../runtime/desktop.ts';
import { AppServer } from './app-server.ts';

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
  const config: Partial<DeviceConfig> &
    Pick<DeviceConfig, 'protocol' | 'deviceId' | 'label'> & { callerCreationPending?: boolean } =
    fs.existsSync(file)
      ? readJson<DeviceConfig>(file)
      : { protocol: 1, deviceId: randomUUID(), label: os.hostname() };
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
      let recovered: string | undefined;
      if (config.callerCreationPending) {
        const matches: string[] = [];
        for (const archived of [false, true]) {
          const list = z
            .object({ data: z.array(z.object({ id: z.string(), cwd: z.string() })) })
            .parse(
              await client.call('thread/list', {
                cwd: path.join(dir, 'caller-workspace'),
                archived,
                sourceKinds: [],
                limit: 10,
                useStateDbOnly: true,
              }),
            );
          matches.push(
            ...list.data
              .filter((row) => row.cwd === path.join(dir, 'caller-workspace'))
              .map((row) => row.id),
          );
        }
        if (matches.length !== 1)
          throw new BridgeError(
            'CALLER_CREATION_UNRESOLVED',
            'Previous creation has an unknown result; do not create another caller',
          );
        recovered = matches[0];
      }
      config.callerCreationPending = true;
      config.codexHome = home;
      writeJson(file, config); // Record intent and device identity before the native side effect.
      const r = recovered
        ? { thread: { id: recovered } }
        : threadReply.parse(
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
        callerCreationPending: false,
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
      desktopVersion: desktop.version,
      codexHome: home,
      installedAt: Date.now(),
    };
    writeJson(file, installed);
    return installed;
  } finally {
    client.close();
  }
}
