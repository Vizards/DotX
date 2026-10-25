import { OAuthProvider, OAuthError } from '@cloudflare/workers-oauth-provider';
import { z } from 'zod';
import type { Env } from '../env.ts';
import { serviceInfo } from '../env.ts';
import { control } from '../hub/namespace.ts';
import { handleMcp } from '../mcp/http.ts';
import { consent } from './consent.ts';
import { providerGrantId, cleanEndedGrants } from './grants.ts';
import { adminRoutes } from '../admin/routes.ts';
import { assets } from '../http/assets.ts';
import { failure, json } from '../http/responses.ts';
const propsSchema = z.object({ agent_id: z.uuid(), round_id: z.uuid() });
const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/setup/info') return json(serviceInfo(env));
      if (request.method === 'GET' && url.pathname === '/health') return json(serviceInfo(env));
      const admin = await adminRoutes(request, env, ctx);
      if (admin) return admin;
      if (
        url.pathname === '/oauth/consent' ||
        (url.pathname === '/authorize' &&
          (request.method !== 'GET' || !url.searchParams.has('transaction')))
      )
        return await consent(request, env);
      return (
        (await assets(request, env)) ??
        json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404)
      );
    } catch (error) {
      return failure(error);
    }
  },
};
export async function serveOAuth(request: Request, env: Env, ctx: ExecutionContext) {
  const provider = new OAuthProvider<Env>({
    apiRoute: '/mcp',
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    defaultHandler,
    accessTokenTTL: 3600,
    refreshTokenTTL: 2592000,
    refreshTokenIdleTTL: 2592000,
    clientRegistrationTTL: 7776000,
    scopesSupported: ['offline_access'],
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      resource: env.PUBLIC_ORIGIN + '/mcp',
      authorization_servers: [env.PUBLIC_ORIGIN],
    },
    tokenExchangeCallback: async (options) => {
      const parsed = propsSchema.safeParse(options.props);
      if (!parsed.success || options.userId !== parsed.data.agent_id)
        throw new OAuthError('invalid_grant', {
          description: 'The connection authorization is invalid.',
        });
      const valid = await control<boolean>(options.env, 'grants/bind', {
        identity: { ...parsed.data, grant_id: options.grantId, client_id: options.clientId },
        expires_at: Date.now() + 2592000_000,
      });
      if (!valid)
        throw new OAuthError('invalid_grant', {
          description:
            'This authorization was revoked or replaced. Reissue the existing connection’s access code.',
        });
    },
    apiHandler: {
      async fetch(request, env, context) {
        const { props, auth } = z
          .object({
            props: propsSchema,
            auth: z.object({
              token: z.string(),
              userId: z.string(),
              clientId: z.string(),
            }),
          })
          .parse(context);
        const grantId = providerGrantId(auth.token);
        const valid =
          auth.userId === props.agent_id &&
          (await control<boolean>(env, 'grants/valid', {
            identity: { ...props, grant_id: grantId, client_id: auth.clientId },
            activate: true,
          }));
        if (!valid)
          return json(
            {
              error: 'invalid_token',
              error_description: 'This connection authorization is no longer active.',
            },
            401,
            {
              'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${env.PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
            },
          );
        context.waitUntil(cleanEndedGrants(env));
        return handleMcp(request, env, {
          principal: JSON.stringify([auth.userId, auth.clientId, grantId]),
          user_id: auth.userId,
          client_id: auth.clientId,
          grant_id: grantId,
          round_id: props.round_id,
        });
      },
    },
  });
  return provider.fetch(request, env, ctx);
}
