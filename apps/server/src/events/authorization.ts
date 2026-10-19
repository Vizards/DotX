import type { Grant } from '@cloudflare/workers-oauth-provider';
import type { EventAuthority } from './subscriptions.ts';
import type { Env } from '../env.ts';
export async function eventAccess(env: Env, auth: EventAuthority, connection: string) {
  if (!auth.devices.includes(connection)) return false;
  if (!auth.user_id || !auth.client_id || !auth.grant_id) return false;
  // Read the known grant without enumerating grants. This uses the provider's
  // documented KV layout; recheck it when upgrading the OAuth SDK:
  // https://github.com/cloudflare/workers-oauth-provider/blob/v1.2.3/storage-schema.md#authorization-grants
  const grant = await env.OAUTH_KV.get<Grant>(`grant:${auth.user_id}:${auth.grant_id}`, 'json');
  return (
    grant !== null &&
    grant.id === auth.grant_id &&
    grant.clientId === auth.client_id &&
    grant.scope.includes('mcp:read') &&
    (!grant.expiresAt || grant.expiresAt * 1000 > Date.now())
  );
}
