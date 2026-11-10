import { Buffer } from 'node:buffer';
import type { Env } from '../env.ts';
import { randomSecret, sha256, sameSecret } from '../http/crypto.ts';
import { HttpError } from '../http/responses.ts';
import { AdminCredentials } from './credentials.ts';
import { saveExpiring } from '../hub/storage.ts';
import { consumeAttempt } from '../hub/attempts.ts';
import {
  BROWSER_CLIENT_ID,
  checkCloudflare,
  cloudflareEmail,
  requestCloudflareToken,
  revokeCloudflareToken,
} from './cloudflare.ts';

// These are product trust anchors, never supplied by the browser.
export const relayOrigin = 'https://oauth.dotx.run';
export const cloudflareCallback = '/admin/auth/cloudflare/callback';
export const cloudflareResult = '/login/cloudflare';
export const loginSeconds = 10 * 60;
const loginKey = (id: string) => 'admin:browser:oauth:' + id;
interface Login {
  expires_at: number;
  state: string;
  return_to: string;
  verifier: string;
  code?: string;
  error?: string;
}
interface InstanceIdentity {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
  kid: string;
}

function safeReturn(value: unknown, origin: string) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/admin', origin);
    if (url.origin === origin && !url.pathname.startsWith('//'))
      return url.pathname + url.search + url.hash;
  } catch {
    // Invalid URLs return to management.
  }
  return '/admin';
}
async function register(assertion: string) {
  try {
    const response = await fetch(relayOrigin + '/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assertion }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error();
    const result = await response.json<{ authorization_url: string }>();
    if (typeof result.authorization_url !== 'string') throw new Error();
    return result.authorization_url;
  } catch {
    throw new HttpError(503, 'CF_RELAY_UNAVAILABLE');
  }
}

export class CloudflareLogin {
  private identity?: Promise<InstanceIdentity>;
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
    // Commit before signing or contacting the relay; failed starts still count.
    await this.store.transaction((tx) => consumeAttempt(tx, 'cloudflare'));
    const verifier = randomSecret(),
      state = randomSecret();
    const issued = Math.floor(Date.now() / 1000);
    const record: Login = {
      expires_at: (issued + loginSeconds) * 1000,
      state,
      return_to: safeReturn(returnTo, this.env.PUBLIC_ORIGIN),
      verifier,
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
    const authorization_url = await register(header + '.' + payload + '.' + signature);
    await this.store.transaction(async (tx) => {
      if (previous) await tx.delete(loginKey(previous));
      await saveExpiring(tx, loginKey(id), record);
    });
    return { authorization_url };
  }
  async callback(id: string, state: string, code: string | null, error: string | null) {
    await this.store.transaction(async (tx) => {
      const record = await tx.get<Login>(loginKey(id));
      if (
        !record ||
        record.expires_at <= Date.now() ||
        !sameSecret(record.state, state) ||
        record.code ||
        record.error
      )
        throw new HttpError(401, 'CF_LOGIN_EXPIRED');
      await tx.put(loginKey(id), {
        ...record,
        ...(error || !code
          ? { error: error === 'access_denied' ? 'CF_AUTHORIZATION_CANCELLED' : 'CF_LOGIN_FAILED' }
          : { code }),
      });
    });
  }
  async complete(id: string) {
    // Consume before the external exchange. A retry cannot reuse a code whose
    // provider response was lost; the browser starts a fresh login instead.
    const record = await this.store.transaction(async (tx) => {
      const current = await tx.get<Login>(loginKey(id));
      if (!current || current.expires_at <= Date.now() || (!current.code && !current.error))
        throw new HttpError(401, 'CF_LOGIN_EXPIRED');
      await tx.delete(loginKey(id));
      return current;
    });
    let email: string | null = null;
    try {
      if (record.error) throw new HttpError(403, record.error);
      const issued = Date.now();
      const tokens = await requestCloudflareToken(BROWSER_CLIENT_ID, {
        grant_type: 'authorization_code',
        code: record.code!,
        code_verifier: record.verifier,
        redirect_uri: relayOrigin + '/callback',
      });
      if (!tokens.refresh_token) {
        await revokeCloudflareToken(BROWSER_CLIENT_ID, tokens.access_token);
        throw new HttpError(503, 'CF_LOGIN_FAILED');
      }
      let identity;
      try {
        identity = await checkCloudflare(tokens.access_token, this.env, BROWSER_CLIENT_ID);
      } catch (error) {
        if (error instanceof HttpError && error.status === 403)
          email = await cloudflareEmail(tokens.access_token).catch(() => null);
        await revokeCloudflareToken(BROWSER_CLIENT_ID, tokens.refresh_token);
        throw error;
      }
      const session = await this.store.transaction((tx) =>
        this.credentials.createSession(tx, {
          client_id: BROWSER_CLIENT_ID,
          subject: identity.subject,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token!,
          expires_at: issued + tokens.expires_in * 1000,
        }),
      );
      return { ...session, return_to: record.return_to };
    } catch (error) {
      const failure = error instanceof HttpError ? error : new HttpError(503, 'CF_LOGIN_FAILED');
      throw new HttpError(failure.status, failure.code, failure.message, {
        return_to: record.return_to,
        email,
      });
    }
  }
}
