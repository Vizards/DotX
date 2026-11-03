import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { BridgeError } from '@dotx/shared/errors';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

function discoverMac(appPath = process.env.DOTX_APP_PATH) {
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

function subdirs(dir: string) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((x) => x.isDirectory())
      .map((x) => path.join(dir, x.name));
  } catch {
    return [];
  }
}

function newestFile(candidates: string[]) {
  let best: string | undefined;
  let bestTime = -1;
  for (const file of candidates) {
    try {
      const time = fs.statSync(file).mtimeMs;
      if (time > bestTime) {
        best = file;
        bestTime = time;
      }
    } catch {}
  }
  return best;
}

function cliVersion(cli: string) {
  const output = execFileSync(cli, ['--version'], {
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
  }).trim();
  return output.split(/\s+/).at(-1) ?? output;
}

function packageVersion(root: string) {
  return /^OpenAI\.Codex_([0-9.]+)_/i.exec(path.basename(root))?.[1];
}

function fromPackageRoot(root: string) {
  // Private package layout, mirroring the macOS bundle check: the executable
  // and the bundled Node runtime must both come from the desktop install.
  const appDir = path.basename(root).toLowerCase() === 'app' ? root : path.join(root, 'app');
  const cli = path.join(appDir, 'resources', 'codex.exe');
  const node = path.join(appDir, 'resources', 'cua_node', 'bin', 'node.exe');
  if (!fs.existsSync(cli) || !fs.existsSync(node)) return undefined;
  const packageRoot = path.basename(root).toLowerCase() === 'app' ? path.dirname(root) : root;
  return { app: packageRoot, cli, node, version: packageVersion(packageRoot) ?? cliVersion(cli) };
}

function discoverWindows(appPath = process.env.DOTX_APP_PATH) {
  if (appPath) {
    const found = fromPackageRoot(appPath);
    if (found) return found;
    throw new BridgeError(
      'DESKTOP_NOT_FOUND',
      'Set DOTX_APP_PATH to the installed Codex package directory',
    );
  }
  // Packaged install under WindowsApps. Listing that root is ACL-restricted
  // for some users; failure there falls through to the per-user runtime.
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  for (const root of subdirs(path.join(programFiles, 'WindowsApps'))) {
    if (!/^OpenAI\.Codex_/i.test(path.basename(root))) continue;
    const found = fromPackageRoot(root);
    if (found) return found;
  }
  // Per-user runtime the desktop app provisions under LocalAppData.
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const codexLocal = path.join(localAppData, 'OpenAI', 'Codex');
  const cli = newestFile(
    subdirs(path.join(codexLocal, 'bin')).map((dir) => path.join(dir, 'codex.exe')),
  );
  const node = newestFile(
    subdirs(path.join(codexLocal, 'runtimes', 'cua_node')).map((dir) =>
      path.join(dir, 'bin', 'node.exe'),
    ),
  );
  if (cli && node) return { app: codexLocal, cli, node, version: cliVersion(cli) };
  throw new BridgeError(
    'DESKTOP_NOT_FOUND',
    'Set DOTX_APP_PATH to the installed Codex package directory',
  );
}

export function discoverDesktop(appPath = process.env.DOTX_APP_PATH) {
  if (process.platform === 'win32') return discoverWindows(appPath);
  return discoverMac(appPath);
}
