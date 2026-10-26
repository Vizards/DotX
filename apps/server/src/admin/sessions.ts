import { Buffer } from 'node:buffer';
import { randomSecret, sha256, sameSecret } from '../http/crypto.ts';
import { HttpError } from '../http/responses.ts';
import { oauthEndpoint, refreshToken, type CloudflareTokens } from './cloudflare.ts';
import { control } from '../hub/namespace.ts';
import type { Env } from '../env.ts';
import { requireClient, type CloudflareClient } from './config.ts';
export const SESSION_COOKIE = 'dotx-admin';
export const LOGIN_COOKIE = 'dotx-admin-login';
export function cookie(request: Request, name: string) {
  return request.headers
    .get('Cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + '='))
    ?.slice(name.length + 1);
}
export function setCookie(env: Env, name: string, value: string, seconds?: number) {
  const lifetime = seconds === undefined ? '' : `; Max-Age=${Math.max(0, Math.floor(seconds))}`;
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${lifetime}${env.PUBLIC_ORIGIN.startsWith('https:') ? '; Secure' : ''}`;
}
async function key(client: CloudflareClient) {
  return crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('dotx:admin-storage:v1:' + client.client_secret),
    ),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}
async function seal(client: CloudflareClient, value: unknown) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    await key(client),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Buffer.concat([nonce, Buffer.from(encrypted)]).toString('base64url');
}
async function open<T>(client: CloudflareClient, value: string | null): Promise<T | null> {
  if (!value) return null;
  const decryptionKey = await key(client);
  try {
    const data = Buffer.from(value, 'base64url');
    return JSON.parse(
      new TextDecoder().decode(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: data.subarray(0, 12) },
          decryptionKey,
          data.subarray(12),
        ),
      ),
    ) as T;
  } catch {
    return null;
  }
}
interface Login {
  verifier: string;
  binding: string;
  returnTo: string;
  expiresAt: number;
}
export interface SessionRecord {
  token: string;
  refreshToken: string;
  csrf: string;
  expiresAt: number;
}
const safeReturn = (path: string | null) =>
  ['/admin', '/admin/devices', '/admin/agents'].includes(path ?? '') ? path! : '/admin';
export async function startLogin(request: Request, env: Env) {
  const client = await requireClient(env);
  const state = randomSecret(),
    binding = randomSecret(),
    verifier = randomSecret();
  const record: Login = {
    verifier,
    binding: await sha256(binding),
    returnTo: safeReturn(new URL(request.url).searchParams.get('return_to')),
    expiresAt: Date.now() + 600_000,
  };
  await env.OAUTH_KV.put('admin:login:' + (await sha256(state)), await seal(client, record), {
    expirationTtl: 600,
  });
  const url = new URL(oauthEndpoint);
  url.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: env.PUBLIC_ORIGIN + '/admin/callback',
    response_type: 'code',
    scope: 'user-details.read memberships.read offline_access',
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.href,
      'Set-Cookie': setCookie(env, LOGIN_COOKIE, binding, 600),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
export async function finishLogin(request: Request, env: Env) {
  const state = new URL(request.url).searchParams.get('state'),
    binding = cookie(request, LOGIN_COOKIE);
  if (!state || !binding) throw new HttpError(401, 'CF_LOGIN_EXPIRED');
  const id = 'admin:login:' + (await sha256(state)),
    record = await open<Login>(await requireClient(env), await env.OAUTH_KV.get(id));
  if (
    !record ||
    record.expiresAt <= Date.now() ||
    !sameSecret(record.binding, await sha256(binding))
  )
    throw new HttpError(401, 'CF_LOGIN_EXPIRED');
  await env.OAUTH_KV.delete(id);
  return record;
}
export async function createSession(env: Env, tokens: CloudflareTokens, expiresAt: number) {
  if (!tokens.refresh_token)
    throw new HttpError(
      503,
      'CF_REFRESH_NOT_CONFIGURED',
      'Enable Refresh Token for this Cloudflare OAuth client, then sign in again.',
    );
  const secret = randomSecret();
  const record: SessionRecord = {
    token: tokens.access_token,
    refreshToken: tokens.refresh_token,
    csrf: randomSecret(),
    expiresAt,
  };
  await control(env, 'admin-session/create', { id: await sha256(secret), record });
  return { record, headers: { 'Set-Cookie': setCookie(env, SESSION_COOKIE, secret) } };
}
async function sessionId(request: Request) {
  const value = cookie(request, SESSION_COOKIE);
  if (!value) throw new HttpError(401, 'CF_LOGIN_REQUIRED', 'Sign in with Cloudflare.');
  return sha256(value);
}
export async function readSession(request: Request, env: Env) {
  return control<SessionRecord>(env, 'admin-session/read', { id: await sessionId(request) });
}
export async function currentSession(request: Request, env: Env, rejectedToken?: string) {
  return control<SessionRecord>(env, 'admin-session/current', {
    id: await sessionId(request),
    rejectedToken,
  });
}
export async function clearSession(request: Request, env: Env) {
  const value = cookie(request, SESSION_COOKIE);
  if (value) await control(env, 'admin-session/delete', { id: await sha256(value) });
  return setCookie(env, SESSION_COOKIE, '', 0);
}

// The existing single DO coordinates token rotation across concurrent requests.
// Session secrets stay encrypted; OAuth login transactions remain short-lived KV entries.
export class AdminSessions {
  private readonly refreshing = new Map<string, Promise<SessionRecord>>();
  private readonly store: DurableObjectStorage;
  private readonly client: () => Promise<CloudflareClient>;
  constructor(store: DurableObjectStorage, client: () => Promise<CloudflareClient>) {
    this.store = store;
    this.client = client;
  }
  async create(id: string, record: SessionRecord) {
    await this.store.put('admin:session:' + id, await seal(await this.client(), record));
  }
  async read(id: string) {
    const record = await open<SessionRecord>(
      await this.client(),
      (await this.store.get<string>('admin:session:' + id)) ?? null,
    );
    if (!record) throw new HttpError(401, 'CF_LOGIN_REQUIRED', 'Sign in with Cloudflare again.');
    return record;
  }
  async delete(id: string) {
    await this.store.delete('admin:session:' + id);
  }
  async current(id: string, rejectedToken?: string): Promise<SessionRecord> {
    const record = await this.read(id);
    if (record.expiresAt > Date.now() && record.token !== rejectedToken) return record;
    const pending = this.refreshing.get(id);
    if (pending) return pending;
    const operation = this.renew(id, rejectedToken);
    this.refreshing.set(id, operation);
    try {
      return await operation;
    } finally {
      this.refreshing.delete(id);
    }
  }
  private async renew(id: string, rejectedToken?: string) {
    const record = await this.read(id);
    if (record.expiresAt > Date.now() && record.token !== rejectedToken) return record;
    const started = Date.now();
    let tokens: CloudflareTokens;
    try {
      tokens = await refreshToken(record.refreshToken, await this.client());
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) await this.delete(id);
      throw error;
    }
    const updated: SessionRecord = {
      ...record,
      token: tokens.access_token,
      refreshToken: tokens.refresh_token || record.refreshToken,
      expiresAt: started + tokens.expires_in * 1000,
    };
    const encrypted = await seal(await this.client(), updated);
    await this.store.transaction(async (tx) => {
      // Logout does not wait for CF and an in-flight refresh must not recreate it.
      if (!(await tx.get('admin:session:' + id)))
        throw new HttpError(401, 'CF_LOGIN_REQUIRED', 'Sign in with Cloudflare again.');
      await tx.put('admin:session:' + id, encrypted);
    });
    return updated;
  }
}
