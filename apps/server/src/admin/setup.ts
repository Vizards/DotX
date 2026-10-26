import type { Env } from '../env.ts';
import type { AdminSetupStatus } from '@dotx/shared/http/admin';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { randomSecret, sha256, sameSecret } from '../http/crypto.ts';
import { HttpError, json, failure } from '../http/responses.ts';
import { readJson } from '../http/body.ts';
import { control } from '../hub/namespace.ts';
import type { CloudflareClient } from './config.ts';

const SETUP_KEY = 'admin:setup';
const CLIENT_KEY = 'admin:oauth-client';
const SETUP_LIFETIME_MS = 24 * 60 * 60 * 1000;
interface SetupTicket {
  hash: string;
  expires_at: number;
}

// These records live in the existing DeviceHub. The temporary CF API token is
// used only by complete(), never persisted or returned to the installer.
export class AdminSetup {
  private busy = false;
  private readonly store: DurableObjectStorage;
  private readonly env: Env;
  constructor(store: DurableObjectStorage, env: Env) {
    this.store = store;
    this.env = env;
  }

  async client(): Promise<CloudflareClient | null> {
    const saved = await this.store.get<CloudflareClient>(CLIENT_KEY);
    if (saved) return saved;
    // Preserve installations from earlier development releases. Ordinary updates
    // keep their existing CF bindings; new installations use the setup page.
    return this.env.CF_OAUTH_CLIENT_ID && this.env.CF_OAUTH_CLIENT_SECRET
      ? { client_id: this.env.CF_OAUTH_CLIENT_ID, client_secret: this.env.CF_OAUTH_CLIENT_SECRET }
      : null;
  }

  async status(): Promise<AdminSetupStatus> {
    const tokenUrl = new URL(
      `https://dash.cloudflare.com/${this.env.CF_ACCOUNT_ID}/api-tokens/create`,
    );
    tokenUrl.searchParams.set(
      'permissionGroupKeys',
      JSON.stringify([{ key: 'oauth_client', type: 'edit' }]),
    );
    tokenUrl.searchParams.set('name', `DotX ${this.env.CF_WORKER_NAME} setup`);
    return {
      configured: !!(await this.client()),
      account_id: this.env.CF_ACCOUNT_ID,
      worker: this.env.CF_WORKER_NAME,
      token_url: tokenUrl.toString(),
    };
  }

  async issue() {
    if (this.busy) throw new HttpError(409, 'SETUP_IN_PROGRESS');
    this.busy = true;
    try {
      const status = await this.status();
      if (status.configured) return { ...status, setup_url: null, expires_at: null };
      const secret = randomSecret();
      const ticket = { hash: await sha256(secret), expires_at: Date.now() + SETUP_LIFETIME_MS };
      await this.store.put(SETUP_KEY, ticket);
      return {
        ...status,
        setup_url: `${this.env.PUBLIC_ORIGIN}/setup/admin#${secret}`,
        expires_at: ticket.expires_at,
      };
    } finally {
      this.busy = false;
    }
  }

  private async ticket(secret: string) {
    const ticket = await this.store.get<SetupTicket>(SETUP_KEY);
    if (
      !secret ||
      !ticket ||
      ticket.expires_at <= Date.now() ||
      !sameSecret(ticket.hash, await sha256(secret))
    )
      throw new HttpError(
        401,
        'SETUP_LINK_EXPIRED',
        'Ask your installation Agent for a new setup link. Do not send it an API token.',
      );
    return ticket;
  }

  async context(secret: string): Promise<AdminSetupStatus> {
    const status = await this.status();
    if (status.configured) return status;
    return { ...status, expires_at: (await this.ticket(secret)).expires_at };
  }

  async complete(secret: string, token: unknown) {
    if (this.busy)
      throw new HttpError(
        409,
        'SETUP_IN_PROGRESS',
        'Setup is already running. Check its status before submitting again.',
      );
    this.busy = true;
    try {
      const status = await this.context(secret);
      if (status.configured) return status;
      if (typeof token !== 'string' || !token.trim())
        throw new HttpError(
          400,
          'CF_API_TOKEN_REQUIRED',
          'Paste the temporary Cloudflare API token here.',
        );
      let response: Response;
      try {
        response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/oauth_clients`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token.trim()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              client_name: `DotX ${this.env.CF_WORKER_NAME}`,
              redirect_uris: [this.env.PUBLIC_ORIGIN + '/admin/callback'],
              response_types: ['code'],
              grant_types: ['authorization_code', 'refresh_token'],
              token_endpoint_auth_method: 'client_secret_post',
              scopes: ['user-details.read', 'memberships.read'],
            }),
            redirect: 'manual',
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
          },
        );
      } catch {
        throw this.unknown();
      }
      if ([401, 403].includes(response.status))
        throw new HttpError(
          400,
          'CF_API_TOKEN_REJECTED',
          'Check that the token has OAuth Client Write for the account shown here and has not expired. Then paste it again.',
        );
      if (!response.ok) {
        if (response.status >= 500) throw this.unknown();
        throw new HttpError(
          502,
          'CF_CLIENT_CREATE_FAILED',
          `Cloudflare rejected client creation (HTTP ${response.status}). Check the token settings before retrying.`,
        );
      }
      const body = await response
        .json<{ success: boolean; result?: Partial<CloudflareClient> }>()
        .catch(() => null);
      const client = body?.result;
      if (
        !body?.success ||
        !client ||
        typeof client.client_id !== 'string' ||
        !client.client_id ||
        typeof client.client_secret !== 'string' ||
        !client.client_secret
      )
        throw this.unknown();
      await this.store.transaction(async (tx) => {
        await tx.put(CLIENT_KEY, {
          client_id: client.client_id,
          client_secret: client.client_secret,
        });
        await tx.delete(SETUP_KEY);
      });
      return this.status();
    } finally {
      this.busy = false;
    }
  }

  private unknown() {
    return new HttpError(
      503,
      'CF_CLIENT_CREATE_OUTCOME_UNKNOWN',
      'Cloudflare may have created the login application. Check this page for completion first. If it is still incomplete, inspect OAuth clients in Cloudflare before retrying; an unused client may need removal.',
    );
  }
}

export async function setupRoutes(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/setup/admin/api') return null;
  try {
    const secret = request.headers.get('X-DotX-Setup') ?? '';
    if (request.method === 'GET')
      return json(await control(env, 'admin-setup/context', { secret }));
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
    if (request.headers.get('Origin') !== env.PUBLIC_ORIGIN) throw new HttpError(403, 'BAD_ORIGIN');
    const input = (await readJson(request)) as { token?: unknown } | null;
    return json(await control(env, 'admin-setup/complete', { secret, token: input?.token }));
  } catch (error) {
    return failure(error);
  }
}
