import { Buffer } from 'node:buffer';
import type { Env } from '../env.ts';
import { randomSecret, sha256, sameSecret } from '../http/crypto.ts';
import { HttpError } from '../http/responses.ts';
import { consumeAttempt } from '../hub/attempts.ts';
import { AdminCredentials } from './credentials.ts';
import { saveExpiring } from './vault.ts';
import {
  checkCloudflare,
  cloudflareEmail,
  requestCloudflareToken,
  revokeCloudflareToken,
} from './cloudflare.ts';
import type { ProviderCredentials } from './cloudflare-session.ts';

// This is a product trust anchor, not a URL or audience supplied by the browser.
export const relayOrigin = 'https://oauth.dotx.run';
export const cloudflareCallback = '/admin/auth/cloudflare/callback';
export const cloudflareResult = '/login/cloudflare';
export const loginSeconds = 10 * 60;
const loginKey = (id: string) => 'admin:browser:oauth:' + id;
interface Login {
  expires_at: number;
  state: string;
  return_to: string;
  client_id: string;
  phase: 'waiting' | 'callback' | 'exchanging' | 'checking' | 'failed';
  sealed: string;
  failure?: { code: string; email: string | null };
}
interface LoginSecrets {
  verifier: string;
  code?: string;
  tokens?: ProviderCredentials;
}
interface InstanceIdentity {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
  kid: string;
}

function safeReturn(value: unknown, origin: string) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  )
    return '/admin';
  const url = new URL(value, origin);
  if (url.origin !== origin || url.hash) return '/admin';
  if (
    ['/admin', '/admin/', '/admin/devices', '/admin/agents', '/admin/security'].includes(
      url.pathname,
    )
  )
    return url.pathname + url.search;
  if (['/authorize', '/authorize/'].includes(url.pathname) && url.searchParams.get('transaction'))
    return '/authorize?transaction=' + encodeURIComponent(url.searchParams.get('transaction')!);
  return '/admin';
}
async function relayRequest(path: string, init?: RequestInit) {
  let response;
  try {
    response = await fetch(relayOrigin + path, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(503, 'CF_RELAY_UNAVAILABLE');
  }
  if (!response.ok) throw new HttpError(503, 'CF_RELAY_UNAVAILABLE');
  try {
    return await response.json<Record<string, unknown>>();
  } catch {
    throw new HttpError(503, 'CF_RELAY_UNAVAILABLE');
  }
}

export class CloudflareLogin {
  private identity?: Promise<InstanceIdentity>;
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly store: DurableObjectStorage;
  private readonly env: Env;
  private readonly credentials: AdminCredentials;
  constructor(store: DurableObjectStorage, env: Env, credentials: AdminCredentials) {
    this.store = store;
    this.env = env;
    this.credentials = credentials;
  }
  private instanceIdentity() {
    return (this.identity ??= this.store
      .transaction(async (tx) => {
        const existing = await tx.get<InstanceIdentity>('admin:oauth:instance-key');
        if (existing) return existing;
        const pair = (await crypto.subtle.generateKey('Ed25519', true, [
          'sign',
          'verify',
        ])) as CryptoKeyPair;
        const publicKey = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
        const value = {
          publicKey,
          privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey,
          kid: await sha256(publicKey.x!),
        };
        await tx.put('admin:oauth:instance-key', value);
        return value;
      })
      .catch((error) => {
        this.identity = undefined;
        throw error;
      }));
  }
  async discovery() {
    const { publicKey, kid } = await this.instanceIdentity();
    return {
      version: 1,
      origin: this.env.PUBLIC_ORIGIN,
      callback_uri: this.env.PUBLIC_ORIGIN + cloudflareCallback,
      key: { kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, kid },
    };
  }
  async start(id: string, previous: string | undefined, returnTo: unknown) {
    await this.store.transaction((tx) => consumeAttempt(tx, 'oauth'));
    const config = await relayRequest('/.well-known/oauth-relay');
    if (
      config.version !== 1 ||
      typeof config.client_id !== 'string' ||
      !/^[a-f0-9]{32}$/.test(config.client_id)
    )
      throw new HttpError(503, 'CF_RELAY_UNAVAILABLE');
    const verifier = randomSecret(),
      state = randomSecret();
    const issued = Math.floor(Date.now() / 1000);
    const record: Login = {
      expires_at: (issued + loginSeconds) * 1000,
      state,
      return_to: safeReturn(returnTo, this.env.PUBLIC_ORIGIN),
      client_id: config.client_id,
      phase: 'waiting',
      sealed: await this.credentials.vault.seal({ verifier }),
    };
    const identity = await this.instanceIdentity();
    const header = Buffer.from(
      JSON.stringify({ alg: 'EdDSA', typ: 'dotx-oauth+jwt', kid: identity.kid }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: this.env.PUBLIC_ORIGIN,
        aud: relayOrigin,
        iat: issued,
        exp: issued + loginSeconds,
        jti: randomSecret(),
        state,
        code_challenge: await sha256(verifier),
      }),
    ).toString('base64url');
    const key = await crypto.subtle.importKey('jwk', identity.privateKey, 'Ed25519', false, [
      'sign',
    ]);
    const signature = Buffer.from(
      await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(header + '.' + payload)),
    ).toString('base64url');
    await this.store.transaction(async (tx) => {
      if (previous) await tx.delete(loginKey(previous));
      await saveExpiring(tx, loginKey(id), record);
    });
    try {
      const registered = await relayRequest('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assertion: header + '.' + payload + '.' + signature }),
      });
      if (typeof registered.authorization_url !== 'string')
        throw new HttpError(503, 'CF_RELAY_UNAVAILABLE');
      const target = new URL(registered.authorization_url);
      if (
        target.origin !== relayOrigin ||
        target.pathname !== '/start' ||
        target.username ||
        target.password ||
        target.hash
      )
        throw new HttpError(503, 'CF_RELAY_UNAVAILABLE');
      return { authorization_url: target.href };
    } catch (error) {
      await this.store.delete(loginKey(id));
      throw error;
    }
  }
  private async read(id: string): Promise<Login> {
    const record = await this.store.get<Login>(loginKey(id));
    if (!record || record.expires_at <= Date.now()) throw new HttpError(401, 'CF_LOGIN_EXPIRED');
    return record;
  }
  async callback(id: string, state: string, code: string | null, error: string | null) {
    const record = await this.read(id);
    if (!sameSecret(state, record.state) || record.phase !== 'waiting')
      throw new HttpError(401, 'CF_LOGIN_EXPIRED');
    const secrets = await this.credentials.vault.open<LoginSecrets>(record.sealed);
    const sealed = await this.credentials.vault.seal({ ...secrets, code });
    await this.store.transaction(async (tx) => {
      const current = await tx.get<Login>(loginKey(id));
      if (
        !current ||
        current.expires_at <= Date.now() ||
        current.phase !== 'waiting' ||
        !sameSecret(current.state, state)
      )
        throw new HttpError(401, 'CF_LOGIN_EXPIRED');
      await tx.put(loginKey(id), {
        ...current,
        sealed,
        phase: error || !code ? 'failed' : 'callback',
        ...(error || !code
          ? {
              failure: {
                code: error === 'access_denied' ? 'CF_AUTHORIZATION_CANCELLED' : 'CF_LOGIN_FAILED',
                email: null,
              },
            }
          : {}),
      });
    });
  }
  async status(id: string) {
    const { return_to, phase, failure } = await this.read(id);
    return { return_to, phase, failure };
  }
  async complete(id: string) {
    const previous = this.pending.get(id);
    if (previous) return previous;
    const operation = this.finish(id);
    this.pending.set(id, operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(id);
    }
  }
  private async finish(id: string) {
    let record = await this.read(id);
    if (record.failure)
      throw new HttpError(403, record.failure.code, record.failure.code, record.failure);
    if (!['callback', 'checking'].includes(record.phase))
      throw new HttpError(401, 'CF_LOGIN_EXPIRED');
    let secrets = await this.credentials.vault.open<LoginSecrets>(record.sealed);
    if (record.phase === 'callback') {
      await this.store.transaction(async (tx) => {
        const current = await tx.get<Login>(loginKey(id));
        if (!current || current.phase !== 'callback' || current.expires_at <= Date.now())
          throw new HttpError(401, 'CF_LOGIN_EXPIRED');
        await tx.put(loginKey(id), { ...current, phase: 'exchanging' });
      });
      const issued = Date.now();
      // A code is exchanged at most once. If delivery is ambiguous, restart the
      // login; never replay a potentially consumed provider authorization code.
      const result = await requestCloudflareToken(record.client_id, {
        grant_type: 'authorization_code',
        code: secrets.code!,
        code_verifier: secrets.verifier,
        redirect_uri: relayOrigin + '/callback',
      });
      if (!result.refresh_token) {
        await revokeCloudflareToken(record.client_id, result.access_token);
        await this.store.delete(loginKey(id));
        throw new HttpError(503, 'CF_REFRESH_UNAVAILABLE');
      }
      secrets = {
        verifier: '',
        tokens: {
          access_token: result.access_token,
          refresh_token: result.refresh_token,
          expires_at: issued + result.expires_in * 1000,
        },
      };
      const sealed = await this.credentials.vault.seal(secrets);
      record = await this.store.transaction(async (tx) => {
        const current = await tx.get<Login>(loginKey(id));
        if (!current || current.phase !== 'exchanging' || current.expires_at <= Date.now())
          throw new HttpError(401, 'CF_LOGIN_EXPIRED');
        const next: Login = { ...current, phase: 'checking', sealed };
        await tx.put(loginKey(id), next);
        return next;
      });
    }
    let identity;
    try {
      identity = await checkCloudflare(secrets.tokens!.access_token, this.env, record.client_id);
    } catch (error) {
      if (error instanceof HttpError && [401, 403].includes(error.status)) {
        const email =
          error.status === 403
            ? await cloudflareEmail(secrets.tokens!.access_token).catch(() => null)
            : null;
        await this.store.transaction(async (tx) => {
          const current = await tx.get<Login>(loginKey(id));
          if (current?.phase === 'checking')
            await tx.put(loginKey(id), {
              ...current,
              phase: 'failed',
              sealed: '',
              failure: { code: error.code, email },
            });
        });
        await revokeCloudflareToken(record.client_id, secrets.tokens!.refresh_token);
        throw new HttpError(error.status, error.code, error.message, { email });
      }
      throw error;
    }
    const sealed = await this.credentials.vault.seal(secrets.tokens);
    return this.store.transaction(async (tx) => {
      const current = await tx.get<Login>(loginKey(id));
      if (!current || current.expires_at <= Date.now() || current.phase !== 'checking')
        throw new HttpError(401, 'CF_LOGIN_EXPIRED');
      await tx.delete(loginKey(id));
      const session = await this.credentials.createSession(tx, {
        client_id: record.client_id,
        subject: identity.subject,
        sealed,
      });
      return { ...session, return_to: record.return_to };
    });
  }
}
