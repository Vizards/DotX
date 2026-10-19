import { WIRE_VERSION } from '@dotx/shared/gateway';
import { z } from 'zod';
import {
  OAuthProvider,
  AuthorizationError,
  CimdFetchError,
} from '@cloudflare/workers-oauth-provider';
import type { Env } from '../env.ts';
import packageInfo from '../../package.json' with { type: 'json' };
import { hub } from '../hub/namespace.ts';
import { handleMcp } from '../mcp/handler.ts';

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function browserAdmin(request: Request, env: Env) {
  // Validation executes in the authoritative DO, not a cached Worker/KV session.
  return (
    await hub(env).fetch(
      new Request(env.PUBLIC_ORIGIN + '/setup/browser-status', {
        headers: { Cookie: request.headers.get('Cookie') ?? '' },
      }),
    )
  ).json<{ admin: boolean }>();
}
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health')
      return json({ service: 'dotx-server', version: packageInfo.version, protocol: WIRE_VERSION });
    if (url.pathname !== '/authorize') return json({ error: 'NOT_FOUND' }, 404);
    const oauth = env.OAUTH_PROVIDER;
    try {
      if (request.method === 'GET') {
        const auth = await oauth.parseAuthRequest(request);
        const browser = await browserAdmin(request, env);
        const details = await oauth.describeConsent(auth),
          consent = await oauth.beginConsent(auth);
        consent.headers.set('Content-Type', 'text/html; charset=utf-8');
        return new Response(
          `<!doctype html><meta charset="utf-8"><title>Authorize DotX Remote</title>
          <h1>Connect DotX Remote</h1><p>Client: ${esc(details.clientName)}</p>
          <p>Publisher domain: ${esc(details.clientDomain || 'Self-registered; name not verified')}; callback: ${esc(details.redirectHost)}</p>
          ${details.redirectIsLoopback ? '<p>This authorizes a local application. Confirm that you initiated this connection.</p>' : ''}
          <p>Allow access to Codex connections you have approved or approve later, including native App Tools and App Server operations for execution, files, tasks and settings.</p>
          <form method="post"><input type="hidden" name="handle" value="${esc(consent.handle)}">
          ${browser.admin ? '<p>Service administrator verified. No key needs to be copied.</p>' : '<p>An administrator session is required. The setup assistant can run setup.mjs admin-link on the Mac holding the owner credentials, open the returned link in this browser session, then restart authorization.</p>'}
          <label><input type="checkbox" name="scope" value="mcp:read" checked>Discover interfaces and read receipts and events</label>
          <label><input type="checkbox" name="scope" value="mcp:write" checked>Call native interfaces and respond to requests</label>
          <p><button name="decision" value="approve">Allow</button><button name="decision" value="deny" formnovalidate>Deny</button></p></form>`,
          { headers: consent.headers },
        );
      }
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
      if (request.headers.get('Origin') !== env.PUBLIC_ORIGIN)
        return json({ error: 'BAD_ORIGIN' }, 403);
      const form = await request.formData(),
        handle = String(form.get('handle') || '');
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      // A random 256-bit owner key, not a guessable human password. Store only its hash remotely.
      if (!(await browserAdmin(request, env)).admin)
        return json({ error: 'ADMIN_SESSION_REQUIRED' }, 401);
      const approved = await oauth.approveConsent(request, handle, {
        scope: form.getAll('scope').map(String),
      });
      const result = await oauth.completeAuthorization({
        request: approved.request,
        userId: 'owner',
        metadata: {},
        scope: approved.request.scope,
        props: { owner: true },
      });
      approved.headers.set('Location', result.redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    } catch (e) {
      if (e instanceof CimdFetchError)
        return json(
          {
            error: 'OAUTH_CLIENT_METADATA_UNAVAILABLE',
            reason:
              /HTTP (\d{3})/.exec(e.detail)?.[0] ||
              (/timed out/i.test(e.detail) ? 'FETCH_TIMEOUT' : 'METADATA_VALIDATION_FAILED'),
            message:
              'Client metadata could not be verified. Retry authorization, or configure Dynamic Client Registration in the MCP client.',
          },
          502,
        );
      if (e instanceof AuthorizationError)
        return json(
          {
            error: 'OAUTH_REQUEST_INVALID',
            message: 'Restart authorization from your MCP client.',
          },
          400,
        );
      throw e;
    }
  },
};

export async function serveOAuth(request: Request, env: Env, ctx: ExecutionContext) {
  const provider = new OAuthProvider<Env>({
    apiRoute: '/mcp',
    apiHandler: {
      fetch: async (r, e, c) => {
        const context = z
          .object({
            props: z.object({ owner: z.literal(true) }),
            auth: z.object({
              scope: z.array(z.string()),
              token: z.string(),
              userId: z.string(),
              clientId: z.string(),
            }),
          })
          .parse(c);
        // OAuthProvider has already authenticated and decrypted this token. Its 1.2.3
        // issued-token format is userId:grantId:secret; ctx.auth omits grantId.
        // Recheck this dependency on SDK upgrades or before enabling external tokens.
        const grantId = context.auth.token.split(':')[1]!;
        return handleMcp(r, e, context.props, context.auth.scope, {
          principal: JSON.stringify([context.auth.userId, context.auth.clientId, grantId]),
          user_id: context.auth.userId,
          client_id: context.auth.clientId,
          grant_id: grantId,
        });
      },
    },
    defaultHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    scopesSupported: ['mcp:read', 'mcp:write', 'offline_access'],
    requiredScopes: ['mcp:read'],
    resourceMetadata: {
      resource: `${env.PUBLIC_ORIGIN}/mcp`,
      authorization_servers: [env.PUBLIC_ORIGIN],
    },
    clientIdMetadataDocumentEnabled: true,
  });
  return provider.fetch(request, env, ctx);
}
