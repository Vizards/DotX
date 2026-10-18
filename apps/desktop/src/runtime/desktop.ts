import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { BridgeError } from '@dotx/shared/errors';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export function discoverDesktop(appPath = process.env.DOTX_APP_PATH) {
  const apps = appPath
    ? [appPath]
    : ['/Applications', path.join(os.homedir(), 'Applications')].flatMap((dir) => {
        try {
          return fs
            .readdirSync(dir)
            .filter((x) => /^(Codex|ChatGPT).*\.app$/.test(x))
            .map((x) => path.join(dir, x));
        } catch {
          return [];
        }
      });
  for (const app of apps) {
    // Private application bundle layout, not an installation API. Updates may move these files;
    // fail discovery explicitly rather than replacing the desktop CLI with another executable.
    const resources = path.join(app, 'Contents/Resources');
    const candidates = ['codex-cli/CodexCLI.app/Contents/MacOS/codex', 'codex'];
    for (const relative of candidates) {
      const cli = path.join(resources, relative);
      const node = path.join(resources, 'cua_node/bin/node');
      if (fs.existsSync(cli) && fs.existsSync(node))
        return {
          app,
          cli,
          node,
          version: execFileSync(
            '/usr/libexec/PlistBuddy',
            ['-c', 'Print CFBundleShortVersionString', path.join(app, 'Contents/Info.plist')],
            { encoding: 'utf8', timeout: DEFAULT_TIMEOUT_MS },
          ).trim(),
        };
    }
  }
  throw new BridgeError('DESKTOP_NOT_FOUND', 'Set DOTX_APP_PATH to the installed desktop .app');
}
