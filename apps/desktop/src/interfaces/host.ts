import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { BridgeError, errorValue } from '@dotx/shared/errors';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { checkedPath } from '../local/paths.ts';
import { runPowerShell } from '../platform/powershell.ts';

let windowsVersion: string | undefined;
function windowsDesktopVersion() {
  if (windowsVersion !== undefined) return windowsVersion;
  try {
    windowsVersion = runPowerShell(
      [
        '-Command',
        "$ErrorActionPreference = 'Stop'; " +
          '$package = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1; ' +
          "if (!$package) { throw 'OpenAI.Codex is not registered for the current Windows user.' }; " +
          '$package.Version',
      ],
      'Cannot read the Codex desktop package version',
      30_000,
    ).trim();
    if (!windowsVersion) throw new Error('CODEX_PACKAGE_VERSION_MISSING');
  } catch (error) {
    windowsVersion = 'unknown';
    process.stderr.write(
      JSON.stringify({ code: 'DESKTOP_VERSION_UNAVAILABLE', cause: errorValue(error) }) + '\n',
    );
  }
  return windowsVersion;
}

export function discoverDesktop(appPath = process.env.DOTX_APP_PATH) {
  // Private host-provided executable, used without package discovery. Desktop
  // Package metadata supplies diagnostics only, never the executable path.
  if (process.platform === 'win32')
    return {
      cli: checkedPath(
        process.env.CODEX_APP_RUNTIME_CLI_PATH,
        'CODEX_APP_RUNTIME_CLI_PATH_REQUIRED',
      ),
      version: windowsDesktopVersion(),
    };
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
