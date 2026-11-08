import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';

const preparedDirectories = new Set<string>();
function prepareWindowsDirectory(dir: string) {
  const key = path.resolve(dir).toLowerCase();
  if (preparedDirectories.has(key)) return;
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
      path.join(root, 'private-directory.ps1'),
      '-Path',
      path.resolve(dir),
    ],
    { timeout: DEFAULT_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  preparedDirectories.add(key);
}
export function privateDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') prepareWindowsDirectory(dir);
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
