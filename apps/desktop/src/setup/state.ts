import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { privateDir, readJson, writeJson } from '../runtime/state.ts';

export interface SetupContext {
  origin?: string;
  enrollmentId?: string;
}

export class SetupState {
  readonly dir: string;
  readonly file: string;
  value: SetupContext;
  constructor(directory: string) {
    this.dir = privateDir(path.join(directory, 'setup'));
    this.file = path.join(this.dir, 'service.json');
    this.value = fs.existsSync(this.file) ? readJson<SetupContext>(this.file) : {};
  }
  save(patch: Partial<SetupContext>) {
    this.value = { ...this.value, ...patch };
    writeJson(this.file, this.value);
  }
  secret(name: 'owner-key' | 'device-token' | 'claim-token') {
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) {
      const fd = fs.openSync(file, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, randomBytes(32).toString('base64url'));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
    return fs.readFileSync(file, 'utf8');
  }
  ownerKey() {
    const file = path.join(this.dir, 'owner-key');
    if (!fs.existsSync(file)) throw new Error('OWNER_CREDENTIAL_NOT_ON_THIS_MAC');
    return fs.readFileSync(file, 'utf8');
  }
  lock() {
    const file = path.join(this.dir, 'lock');
    if (fs.existsSync(file)) {
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('SETUP_LOCK_REQUIRES_INSPECTION');
      try {
        process.kill(pid, 0);
        throw new Error('SETUP_ALREADY_RUNNING');
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH'))
          throw error;
      }
      fs.unlinkSync(file);
    }
    fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 });
    return () => fs.unlinkSync(file);
  }
}

export function serviceOrigin(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['/', '/mcp'].includes(url.pathname)
  )
    throw new Error('INVALID_SERVICE_URL');
  return url.origin;
}

export async function api<T = Record<string, unknown>>(
  origin: string,
  route: string,
  body?: unknown,
  token?: string,
) {
  const response = await fetch(origin + route, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'error',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw Object.assign(new Error(data.error ?? 'SERVICE_REQUEST_FAILED'), { code: data.error });
  return data;
}
