import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export const stateDir = () =>
  process.env.DOTX_STATE_DIR || path.join(os.homedir(), '.local/state/dotx');
export function privateDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}
export function readJson<T = unknown>(file: fs.PathOrFileDescriptor): T {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function writeJson(file: string, value: unknown) {
  privateDir(path.dirname(file));
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}
