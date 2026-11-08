import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';

const prepared = new Set<string>();
function prepareWindowsPath(file: string, directory = false) {
  const key = `${directory}:${path.resolve(file).toLowerCase()}`;
  if (prepared.has(key)) return;
  const root = process.env.DOTX_PLUGIN_ROOT || path.dirname(fileURLToPath(import.meta.url));
  execFileSync(
    path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    ),
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'private-path.ps1'),
      '-Path',
      path.resolve(file),
      ...(directory ? ['-Directory'] : []),
    ],
    { timeout: DEFAULT_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  prepared.add(key);
}
export function preparePrivateFile(file: string) {
  if (process.platform !== 'win32') return;
  privateDir(path.dirname(file));
  prepareWindowsPath(file);
}
export function privateDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') prepareWindowsPath(dir, true);
  else fs.chmodSync(dir, 0o700);
  return dir;
}
export function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}
export function writePrivate(file: string, value: string) {
  const directory = privateDir(path.dirname(file)),
    temporary = `${file}.${randomUUID()}.tmp`,
    fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(fd, value);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
    if (process.platform === 'win32') return;
    const parent = fs.openSync(directory, 'r');
    try {
      fs.fsyncSync(parent);
    } finally {
      fs.closeSync(parent);
    }
  } finally {
    // Close the file before cleanup, including when the rename itself failed.
    try {
      fs.rmSync(temporary, { force: true });
    } catch {}
  }
}
export const writeJson = (file: string, value: unknown) =>
  writePrivate(file, JSON.stringify(value, null, 2) + '\n');
