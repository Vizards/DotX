import { Buffer } from 'node:buffer';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type WebAuthnCredential,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import type { Env } from '../env.ts';
import type { Store } from '../hub/storage.ts';
import { attemptKeys, consumeAttempt } from '../hub/attempts.ts';
import { AdminVault } from './vault.ts';
import {
  CloudflareSessions,
  browserSessionKey as sessionKey,
  type ProviderSession,
  type StoredSession,
} from './cloudflare-session.ts';
import { randomSecret, sha256, sameSecret } from '../http/crypto.ts';
import { HttpError } from '../http/responses.ts';
import { passwordHash, passwordMatches, type PasswordHash } from './password.ts';

const credentialsKey = 'admin:credentials';
const temporary = 'admin:browser:';
const setupKey = temporary + 'setup';
const ceremonyKey = (id: string) => temporary + 'ceremony:' + id;
export const sessionSeconds = 30 * 24 * 60 * 60;
const sessionRenewalInterval = 60 * 60 * 1000;
export const ceremonySeconds = 5 * 60;
const setupMilliseconds = 24 * 60 * 60 * 1000;
interface Passkey extends WebAuthnCredential {
  name: string;
  created_at: number;
}
interface Credentials {
  user_id: string;
  initialized?: boolean;
  password?: PasswordHash;
  passkeys: Passkey[];
}
interface Expiring {
  expires_at: number;
}
interface Setup extends Expiring {
  hash: string;
  reset: boolean;
}
interface Ceremony extends Expiring {
  challenge: string;
  purpose: 'login' | 'register';
  authority?: string;
  user_id: string;
}
export interface BrowserSession extends Expiring {
  csrf: string;
  subject?: string;
}
export interface BrowserAuthority {
  setup?: string;
  session?: string;
  csrf?: string;
}

// All three browser login methods manage the same service. Provider sessions
// retain their identity and permission checks; Personal Agent grants are separate.
export class AdminCredentials {
  private readonly store: DurableObjectStorage;
  private readonly env: Env;
  readonly vault: AdminVault;
  private readonly cloudflareSessions: CloudflareSessions;
  constructor(store: DurableObjectStorage, env: Env) {
    this.store = store;
    this.env = env;
    this.vault = new AdminVault(store);
    this.cloudflareSessions = new CloudflareSessions(store, env, this.vault);
  }
  private async credentials(tx: Store): Promise<Credentials> {
    return (await tx.get<Credentials>(credentialsKey)) ?? { user_id: randomSecret(), passkeys: [] };
  }
  private async save(tx: Store, key: string, value: Expiring) {
    await tx.put(key, value);
    const alarm = await tx.getAlarm();
    if (alarm === null || alarm > value.expires_at) await tx.setAlarm(value.expires_at);
  }
  private async live<T extends Expiring>(tx: Store, key: string, code: string): Promise<T> {
    const value = await tx.get<T>(key);
    if (!value || value.expires_at <= Date.now()) throw new HttpError(401, code);
    return value;
  }
  async status() {
    const credentials = await this.credentials(this.store);
    return {
      initialized:
        !!credentials.initialized || !!credentials.password || credentials.passkeys.length > 0,
      configured: !!credentials.password || credentials.passkeys.length > 0,
      password_enabled: !!credentials.password,
      passkey_enabled: credentials.passkeys.length > 0,
      worker: this.env.CF_WORKER_NAME,
    };
  }
  async security() {
    const credentials = await this.credentials(this.store);
    return {
      password_enabled: !!credentials.password,
      passkeys: credentials.passkeys.map(({ id, name, created_at }) => ({ id, name, created_at })),
    };
  }
  async issue(reset: boolean) {
    return this.store.transaction(async (tx) => {
      const credentials = await this.credentials(tx);
      const configured = !!credentials.password || credentials.passkeys.length > 0;
      if (configured && !reset) return { configured, setup_url: null, expires_at: null };
      const secret = randomSecret();
      const ticket = {
        hash: await sha256(secret),
        reset: configured,
        expires_at: Date.now() + setupMilliseconds,
      };
      await this.save(tx, setupKey, ticket);
      return {
        configured,
        setup_url: `${this.env.PUBLIC_ORIGIN}/setup/admin#${secret}`,
        expires_at: ticket.expires_at,
      };
    });
  }
  private async setup(tx: Store, hash: string) {
    const ticket = await this.live<Setup>(tx, setupKey, 'SETUP_LINK_EXPIRED');
    if (!sameSecret(ticket.hash, hash)) throw new HttpError(401, 'SETUP_LINK_EXPIRED');
    return ticket;
  }
  async context(hash: string) {
    return {
      ...(await this.status()),
      ...(await this.store.transaction(async (tx) => {
        const { reset, expires_at } = await this.setup(tx, hash);
        return { reset, expires_at };
      })),
    };
  }
  async session(id: string, csrf?: string, validateProvider = true) {
    const before = await this.live<StoredSession>(
      this.store,
      sessionKey(id),
      'ADMIN_LOGIN_REQUIRED',
    );
    if (csrf !== undefined && !sameSecret(before.csrf, csrf))
      throw new HttpError(403, 'CSRF_REQUIRED');
    if (validateProvider && before.cloudflare) await this.cloudflareSessions.validate(id);
    // Check and extend atomically; a late request cannot recreate a revoked session.
    return this.store.transaction(async (tx) => {
      const session = await this.live<StoredSession>(tx, sessionKey(id), 'ADMIN_LOGIN_REQUIRED');
      if (csrf !== undefined && !sameSecret(session.csrf, csrf))
        throw new HttpError(403, 'CSRF_REQUIRED', 'Refresh the management page before retrying.');
      const expiresAt = Date.now() + sessionSeconds * 1000;
      if (expiresAt - session.expires_at >= sessionRenewalInterval) {
        session.expires_at = expiresAt;
        await this.save(tx, sessionKey(id), session);
      }
      return {
        csrf: session.csrf,
        expires_at: session.expires_at,
        subject: session.cloudflare?.subject ?? 'administrator',
      };
    });
  }
  async logout(id: string) {
    await this.store.delete(sessionKey(id));
  }
  private async authority(tx: Store, auth: BrowserAuthority): Promise<Credentials> {
    if (auth.setup) {
      const ticket = await this.setup(tx, auth.setup);
      if (ticket.reset) return { user_id: randomSecret(), passkeys: [] };
    } else {
      const session = await this.live<BrowserSession>(
        tx,
        sessionKey(auth.session ?? ''),
        'ADMIN_LOGIN_REQUIRED',
      );
      if (!sameSecret(session.csrf, auth.csrf ?? '')) throw new HttpError(403, 'CSRF_REQUIRED');
    }
    return this.credentials(tx);
  }
  private binding(auth: BrowserAuthority) {
    return auth.setup ? 'setup:' + auth.setup : 'session:' + auth.session;
  }
  async createSession(tx: Store, cloudflare?: ProviderSession) {
    const credentials = await this.credentials(tx);
    if (!credentials.initialized)
      await tx.put(credentialsKey, { ...credentials, initialized: true });
    const secret = randomSecret();
    const record: StoredSession = {
      csrf: randomSecret(),
      expires_at: Date.now() + sessionSeconds * 1000,
      ...(cloudflare ? { cloudflare } : {}),
    };
    await this.save(tx, sessionKey(await sha256(secret)), record);
    return { secret, csrf: record.csrf, expires_at: record.expires_at };
  }
  private async changed(tx: Store, credentials: Credentials, auth: BrowserAuthority) {
    const current = auth.session
      ? await tx.get<StoredSession>(sessionKey(auth.session))
      : undefined;
    await tx.put(credentialsKey, { ...credentials, initialized: true });
    // Revoke other sessions and unfinished ceremonies, retaining the current
    // authentication method when issuing its replacement cookie.
    const records = await tx.list({ prefix: temporary });
    for (const key of records.keys())
      if (key !== attemptKeys.login && key !== attemptKeys.oauth) await tx.delete(key);
    return this.createSession(tx, current?.cloudflare);
  }
  async setPassword(auth: BrowserAuthority, password: unknown) {
    return this.store.transaction(async (tx) => {
      const credentials = await this.authority(tx, auth);
      credentials.password = passwordHash(password);
      return this.changed(tx, credentials, auth);
    });
  }
  async renamePasskey(auth: BrowserAuthority, passkeyId: string, name: unknown) {
    return this.store.transaction(async (tx) => {
      const credentials = await this.authority(tx, auth);
      const passkey = credentials.passkeys.find((key) => key.id === passkeyId);
      if (!passkey) throw new HttpError(404, 'PASSKEY_NOT_FOUND');
      const label = typeof name === 'string' ? name.trim() : '';
      if (!label) throw new HttpError(400, 'PASSKEY_NAME_REQUIRED');
      passkey.name = label.slice(0, 64);
      await tx.put(credentialsKey, credentials);
      return credentials.passkeys.map(({ id, name: label, created_at }) => ({
        id,
        name: label,
        created_at,
      }));
    });
  }
  async remove(auth: BrowserAuthority, passkeyId?: string) {
    return this.store.transaction(async (tx) => {
      const credentials = await this.authority(tx, auth);
      if (passkeyId === undefined) delete credentials.password;
      else credentials.passkeys = credentials.passkeys.filter((key) => key.id !== passkeyId);
      return this.changed(tx, credentials, auth);
    });
  }
  private async attempt() {
    // Commit the budget before verification; failures must not roll it back.
    await this.store.transaction((tx) => consumeAttempt(tx, 'login'));
  }
  async loginPassword(password: unknown) {
    await this.attempt();
    return this.store.transaction(async (tx) => {
      const credentials = await this.credentials(tx);
      if (!credentials.password || !passwordMatches(password, credentials.password))
        throw new HttpError(
          401,
          'INVALID_LOGIN',
          'The password did not match. Try again or use a passkey.',
        );
      return this.createSession(tx);
    });
  }
  async registrationOptions(auth: BrowserAuthority, id: string) {
    return this.store.transaction(async (tx) => {
      const credentials = await this.authority(tx, auth);
      const options = await generateRegistrationOptions({
        rpID: new URL(this.env.PUBLIC_ORIGIN).hostname,
        rpName: 'DotX ' + this.env.CF_WORKER_NAME,
        userID: Buffer.from(credentials.user_id, 'base64url'),
        userName: this.env.CF_WORKER_NAME,
        userDisplayName: 'DotX administrator',
        excludeCredentials: credentials.passkeys.map(({ id, transports }) => ({ id, transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      });
      await this.save(tx, ceremonyKey(id), {
        challenge: options.challenge,
        purpose: 'register',
        authority: this.binding(auth),
        user_id: credentials.user_id,
        expires_at: Date.now() + ceremonySeconds * 1000,
      } as Ceremony);
      return options;
    });
  }
  private async takeCeremony(id: string, purpose: Ceremony['purpose']) {
    return this.store.transaction(async (tx) => {
      const ceremony = await this.live<Ceremony>(tx, ceremonyKey(id), 'PASSKEY_REQUEST_EXPIRED');
      if (ceremony.purpose !== purpose) throw new HttpError(401, 'PASSKEY_REQUEST_EXPIRED');
      await tx.delete(ceremonyKey(id));
      return ceremony;
    });
  }
  async register(
    auth: BrowserAuthority,
    id: string,
    response: RegistrationResponseJSON,
    name: unknown,
  ) {
    const ceremony = await this.takeCeremony(id, 'register');
    if (ceremony.authority !== this.binding(auth))
      throw new HttpError(401, 'PASSKEY_REQUEST_EXPIRED');
    let result;
    try {
      result = await verifyRegistrationResponse({
        response,
        expectedChallenge: ceremony.challenge,
        expectedOrigin: this.env.PUBLIC_ORIGIN,
        expectedRPID: new URL(this.env.PUBLIC_ORIGIN).hostname,
      });
    } catch {
      throw new HttpError(
        400,
        'PASSKEY_VERIFICATION_FAILED',
        'Passkey registration could not be verified. Start again.',
      );
    }
    if (!result.verified) throw new HttpError(400, 'PASSKEY_VERIFICATION_FAILED');
    const credential = result.registrationInfo.credential;
    return this.store.transaction(async (tx) => {
      const credentials = await this.authority(tx, auth);
      // Setup has no persistent user yet. The server-generated handle belongs to
      // this consumed, authority-bound ceremony, never to a browser input.
      if (auth.setup) credentials.user_id = ceremony.user_id;
      if (credentials.user_id !== ceremony.user_id)
        throw new HttpError(401, 'PASSKEY_REQUEST_EXPIRED');
      if (credentials.passkeys.some((key) => key.id === credential.id))
        throw new HttpError(409, 'PASSKEY_ALREADY_ADDED');
      credentials.passkeys.push({
        ...credential,
        name: typeof name === 'string' && name.trim() ? name.trim() : 'Passkey',
        created_at: Date.now(),
      });
      return this.changed(tx, credentials, auth);
    });
  }
  async authenticationOptions(id: string) {
    await this.attempt();
    return this.store.transaction(async (tx) => {
      const credentials = await this.credentials(tx);
      if (!credentials.passkeys.length) throw new HttpError(409, 'PASSKEY_NOT_CONFIGURED');
      const options = await generateAuthenticationOptions({
        rpID: new URL(this.env.PUBLIC_ORIGIN).hostname,
        userVerification: 'required',
      });
      await this.save(tx, ceremonyKey(id), {
        challenge: options.challenge,
        purpose: 'login',
        user_id: credentials.user_id,
        expires_at: Date.now() + ceremonySeconds * 1000,
      } as Ceremony);
      return options;
    });
  }
  async loginPasskey(id: string, response: AuthenticationResponseJSON) {
    const ceremony = await this.takeCeremony(id, 'login');
    return this.store.transaction(async (tx) => {
      const credentials = await this.credentials(tx);
      const credential = credentials.passkeys.find((key) => key.id === response?.id);
      if (
        !credential ||
        credentials.user_id !== ceremony.user_id ||
        response.response?.userHandle !== credentials.user_id
      )
        throw new HttpError(
          401,
          'INVALID_LOGIN',
          'This passkey does not belong to this DotX service.',
        );
      let result;
      try {
        result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: ceremony.challenge,
          expectedOrigin: this.env.PUBLIC_ORIGIN,
          expectedRPID: new URL(this.env.PUBLIC_ORIGIN).hostname,
          credential,
        });
      } catch {
        throw new HttpError(
          401,
          'PASSKEY_VERIFICATION_FAILED',
          'Passkey login could not be verified. Start again.',
        );
      }
      if (!result.verified) throw new HttpError(401, 'PASSKEY_VERIFICATION_FAILED');
      credential.counter = result.authenticationInfo.newCounter;
      await tx.put(credentialsKey, credentials);
      return this.createSession(tx);
    });
  }
  async cleanup() {
    await this.store.transaction(async (tx) => {
      const records = await tx.list<Expiring>({ prefix: temporary });
      let next = Infinity;
      for (const [key, value] of records) {
        if (value.expires_at <= Date.now()) await tx.delete(key);
        else next = Math.min(next, value.expires_at);
      }
      const alarm = await tx.getAlarm();
      if (Number.isFinite(next) && (alarm === null || alarm > next)) await tx.setAlarm(next);
    });
  }
}
