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
import type { AdminClaim as Claim } from '@dotx/shared/http/admin';
import { randomSecret, sha256, sameSecret } from '../http/crypto.ts';
import { HttpError } from '../http/responses.ts';
import { passwordHash, passwordMatches, type PasswordHash } from './password.ts';

const credentialsKey = 'admin:credentials';
const temporary = 'admin:browser:';
const setupKey = temporary + 'setup';
const claimKey = (id: string) => temporary + 'claim:' + id;
const attemptKey = temporary + 'attempts';
const claimAttemptKey = temporary + 'claim-attempts';
const sessionKey = (id: string) => temporary + 'session:' + id;
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
}
export interface BrowserAuthority {
  setup?: string;
  claim?: string;
  session?: string;
  csrf?: string;
}

// One administrator for this service. Passwords, passkeys and browser sessions
// do not carry Cloudflare identities or affect Personal Agent OAuth grants.
export class AdminCredentials {
  private readonly store: DurableObjectStorage;
  private readonly env: Env;
  constructor(store: DurableObjectStorage, env: Env) {
    this.store = store;
    this.env = env;
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
  async startClaim(id: string | undefined, nextId: string, restart: boolean) {
    return this.store.transaction(async (tx) => {
      const previous = id ? await tx.get<Claim>(claimKey(id)) : undefined;
      if (previous && previous.expires_at > Date.now() && !restart)
        return { claim: previous, created: false };
      await this.consumeAttempt(tx, 'claim');
      if (id) await tx.delete(claimKey(id));
      const credentials = await this.credentials(tx);
      const claim: Claim = {
        challenge: randomSecret(),
        reset: !!credentials.password || credentials.passkeys.length > 0,
        verified: false,
        expires_at: Date.now() + setupMilliseconds,
      };
      await this.save(tx, claimKey(nextId), claim);
      return { claim, created: true };
    });
  }
  async verifyClaim(id: string | undefined, deployedChallenge: string | undefined) {
    return this.store.transaction(async (tx) => {
      const claim = id ? await tx.get<Claim>(claimKey(id)) : undefined;
      if (!claim || claim.expires_at <= Date.now()) return null;
      if (!claim.verified && deployedChallenge && sameSecret(claim.challenge, deployedChallenge)) {
        claim.verified = true;
        await this.save(tx, claimKey(id!), claim);
      }
      return claim;
    });
  }
  async session(id: string, csrf?: string) {
    // Check and extend atomically; a late request cannot recreate a revoked session.
    return this.store.transaction(async (tx) => {
      const session = await this.live<BrowserSession>(tx, sessionKey(id), 'ADMIN_LOGIN_REQUIRED');
      if (csrf !== undefined && !sameSecret(session.csrf, csrf))
        throw new HttpError(403, 'CSRF_REQUIRED', 'Refresh the management page before retrying.');
      const expiresAt = Date.now() + sessionSeconds * 1000;
      if (expiresAt - session.expires_at >= sessionRenewalInterval) {
        session.expires_at = expiresAt;
        await this.save(tx, sessionKey(id), session);
      }
      return session;
    });
  }
  async logout(id: string) {
    await this.store.delete(sessionKey(id));
  }
  private async authority(tx: Store, auth: BrowserAuthority): Promise<Credentials> {
    if (auth.setup || auth.claim) {
      const ticket = auth.setup
        ? await this.setup(tx, auth.setup)
        : await this.live<Claim>(tx, claimKey(auth.claim!), 'CLAIM_EXPIRED');
      if ('verified' in ticket && !ticket.verified)
        throw new HttpError(403, 'CLAIM_NOT_VERIFIED', 'Verify the Cloudflare Secret first.');
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
    return auth.setup
      ? 'setup:' + auth.setup
      : auth.claim
        ? 'claim:' + auth.claim
        : 'session:' + auth.session;
  }
  private async createSession(tx: Store) {
    const secret = randomSecret();
    const record = { csrf: randomSecret(), expires_at: Date.now() + sessionSeconds * 1000 };
    await this.save(tx, sessionKey(await sha256(secret)), record);
    return { secret, ...record };
  }
  private async changed(tx: Store, credentials: Credentials) {
    await tx.put(credentialsKey, credentials);
    // A credential change revokes old browser sessions and unfinished ceremonies.
    // It never changes devices, Personal Agent grants, or Wrangler authority.
    const records = await tx.list({ prefix: temporary });
    for (const key of records.keys())
      if (key !== attemptKey && key !== claimAttemptKey) await tx.delete(key);
    return this.createSession(tx);
  }
  async setPassword(auth: BrowserAuthority, password: unknown) {
    return this.store.transaction(async (tx) => {
      const credentials = await this.authority(tx, auth);
      credentials.password = passwordHash(password);
      return this.changed(tx, credentials);
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
      if (!credentials.password && !credentials.passkeys.length)
        throw new HttpError(
          409,
          'LAST_LOGIN_METHOD',
          'Add another password or passkey before removing the last login method.',
        );
      return this.changed(tx, credentials);
    });
  }
  private async attempt() {
    // Commit the budget before verification; failures must not roll it back.
    await this.store.transaction((tx) => this.consumeAttempt(tx, 'login'));
  }
  private async consumeAttempt(tx: Store, kind: 'login' | 'claim') {
    const key = kind === 'claim' ? claimAttemptKey : attemptKey;
    const now = Date.now();
    let budget = await tx.get<Expiring & { count: number }>(key);
    if (!budget || budget.expires_at <= now) budget = { count: 0, expires_at: now + 60_000 };
    if (budget.count >= 10) {
      const seconds = Math.ceil((budget.expires_at - now) / 1000);
      throw new HttpError(
        429,
        kind === 'claim' ? 'CLAIM_ATTEMPTS_EXHAUSTED' : 'LOGIN_ATTEMPTS_EXHAUSTED',
        kind === 'claim'
          ? `Too many new setup or recovery requests on this Server. Try again in ${seconds} seconds. Existing requests can still continue.`
          : 'Too many login attempts. Try again after this one-minute window.',
        { retry_after_seconds: seconds },
      );
    }
    budget.count++;
    // These two fixed counters reset on use; they do not need their own alarms.
    await tx.put(key, budget);
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
      if (auth.setup || auth.claim) credentials.user_id = ceremony.user_id;
      if (credentials.user_id !== ceremony.user_id)
        throw new HttpError(401, 'PASSKEY_REQUEST_EXPIRED');
      if (credentials.passkeys.some((key) => key.id === credential.id))
        throw new HttpError(409, 'PASSKEY_ALREADY_ADDED');
      credentials.passkeys.push({
        ...credential,
        name: typeof name === 'string' && name.trim() ? name.trim() : 'Passkey',
        created_at: Date.now(),
      });
      return this.changed(tx, credentials);
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
