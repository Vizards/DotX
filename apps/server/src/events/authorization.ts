import type { EventAuthority } from './subscriptions.ts';
import type { Env } from '../env.ts';
// Use the OAuth provider's public helpers; no dependency on its private KV key layout.
export async function eventAccess(env: Env, auth: EventAuthority, connection: string) {
  if (!auth.devices.includes(connection)) return false;
  if (!auth.user_id || !auth.client_id || !auth.grant_id) return false;
  const { getOAuthApi } = await import('@cloudflare/workers-oauth-provider');
  const helpers = getOAuthApi(
    {
      apiRoute: '/mcp',
      apiHandler: { fetch: () => new Response(null, { status: 404 }) },
      defaultHandler: { fetch: () => new Response(null, { status: 404 }) },
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      resourceMetadata: {
        resource: `${env.PUBLIC_ORIGIN}/mcp`,
        authorization_servers: [env.PUBLIC_ORIGIN],
      },
    },
    env,
  );
  let cursor: string | undefined;
  do {
    const page = await helpers.listUserGrants(auth.user_id, { limit: 100, cursor });
    const grant = page.items.find((g) => g.id === auth.grant_id && g.clientId === auth.client_id);
    if (grant)
      return (
        grant.scope.includes('mcp:read') &&
        (!grant.expiresAt || grant.expiresAt * 1000 > Date.now())
      );
    cursor = page.cursor;
  } while (cursor);
  return false;
}
