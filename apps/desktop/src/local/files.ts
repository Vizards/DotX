import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export function privateDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
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
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {}
    throw error;
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
  // Windows cannot open or fsync a directory handle; the rename above is the
  // durability boundary there.
  if (process.platform === 'win32') return;
  const parent = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}
export const writeJson = (file: string, value: unknown) =>
  writePrivate(file, JSON.stringify(value, null, 2) + '\n');
