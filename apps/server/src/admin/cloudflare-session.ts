import type { Env } from '../env.ts';
import { HttpError } from '../http/responses.ts';
import { checkCloudflare, requestCloudflareToken } from './cloudflare.ts';

export const browserSessionKey = (id: string) => 'admin:browser:session:' + id;
export interface ProviderSession {
  client_id: string;
  subject: string;
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
  constructor(store: DurableObjectStorage, env: Env) {
    this.store = store;
    this.env = env;
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
    if (!record.cloudflare) return;
    let provider: ProviderSession = record.cloudflare;
    let refreshed = false;
    const renew = async () => {
      const issued = Date.now();
      const result = await requestCloudflareToken(provider.client_id, {
        grant_type: 'refresh_token',
        refresh_token: provider.refresh_token,
      });
      provider = {
        ...provider,
        access_token: result.access_token,
        refresh_token: result.refresh_token || provider.refresh_token,
        expires_at: issued + result.expires_in * 1000,
      };
      await this.store.transaction(async (tx) => {
        const current = await tx.get<StoredSession>(browserSessionKey(id));
        if (!current || current.expires_at <= Date.now())
          throw new HttpError(401, 'ADMIN_LOGIN_REQUIRED');
        // Rotation is saved before permission checks, including retryable failures.
        await tx.put(browserSessionKey(id), { ...current, cloudflare: provider });
      });
      refreshed = true;
    };
    try {
      if (provider.expires_at <= Date.now()) await renew();
      try {
        await checkCloudflare(provider.access_token, this.env, provider.client_id);
      } catch (error) {
        if (!(error instanceof HttpError) || error.code !== 'CF_LOGIN_REQUIRED' || refreshed)
          throw error;
        await renew();
        await checkCloudflare(provider.access_token, this.env, provider.client_id);
      }
    } catch (error) {
      if (error instanceof HttpError && [401, 403].includes(error.status))
        await this.store.delete(browserSessionKey(id));
      throw error;
    }
  }
}
