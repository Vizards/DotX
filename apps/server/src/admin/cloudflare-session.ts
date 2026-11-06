import type { Env } from '../env.ts';
import { HttpError } from '../http/responses.ts';
import { AdminVault } from './vault.ts';
import { checkCloudflare, requestCloudflareToken } from './cloudflare.ts';

export const browserSessionKey = (id: string) => 'admin:browser:session:' + id;
export interface ProviderSession {
  client_id: string;
  subject: string;
  sealed: string;
}
export interface ProviderCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
export interface StoredSession {
  csrf: string;
  expires_at: number;
  cloudflare?: ProviderSession;
}

export class CloudflareSessions {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly store: DurableObjectStorage;
  private readonly env: Env;
  private readonly vault: AdminVault;
  constructor(store: DurableObjectStorage, env: Env, vault: AdminVault) {
    this.store = store;
    this.env = env;
    this.vault = vault;
  }
  async validate(id: string) {
    const previous = this.pending.get(id);
    if (previous) return previous;
    const operation = this.check(id);
    this.pending.set(id, operation);
    try {
      await operation;
    } finally {
      this.pending.delete(id);
    }
  }
  private async read(id: string) {
    const record = await this.store.get<StoredSession>(browserSessionKey(id));
    if (!record || record.expires_at <= Date.now())
      throw new HttpError(401, 'ADMIN_LOGIN_REQUIRED');
    return record;
  }
  private async check(id: string) {
    const record = await this.read(id);
    const provider = record.cloudflare;
    if (!provider) return;
    let tokens = await this.vault.open<ProviderCredentials>(provider.sealed);
    let refreshed = false;
    const renew = async () => {
      const issued = Date.now();
      const result = await requestCloudflareToken(provider.client_id, {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
      });
      tokens = {
        access_token: result.access_token,
        refresh_token: result.refresh_token || tokens.refresh_token,
        expires_at: issued + result.expires_in * 1000,
      };
      const sealed = await this.vault.seal(tokens);
      await this.store.transaction(async (tx) => {
        const current = await tx.get<StoredSession>(browserSessionKey(id));
        if (
          !current ||
          current.expires_at <= Date.now() ||
          current.cloudflare?.sealed !== provider.sealed
        )
          throw new HttpError(401, 'ADMIN_LOGIN_REQUIRED');
        // Rotation is saved before permission checks, including retryable failures.
        await tx.put(browserSessionKey(id), { ...current, cloudflare: { ...provider, sealed } });
      });
      provider.sealed = sealed;
      refreshed = true;
    };
    try {
      if (tokens.expires_at <= Date.now()) await renew();
      let identity;
      try {
        identity = await checkCloudflare(tokens.access_token, this.env, provider.client_id);
      } catch (error) {
        if (!(error instanceof HttpError) || error.code !== 'CF_LOGIN_REQUIRED' || refreshed)
          throw error;
        await renew();
        identity = await checkCloudflare(tokens.access_token, this.env, provider.client_id);
      }
      if (identity.subject !== provider.subject) throw new HttpError(401, 'CF_IDENTITY_INVALID');
    } catch (error) {
      if (error instanceof HttpError && [401, 403].includes(error.status)) {
        await this.store.transaction(async (tx) => {
          const current = await tx.get<StoredSession>(browserSessionKey(id));
          if (current?.cloudflare?.sealed === provider.sealed)
            await tx.delete(browserSessionKey(id));
        });
      }
      throw error;
    }
  }
}
