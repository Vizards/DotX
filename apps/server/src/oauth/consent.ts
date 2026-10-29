import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../env.ts';
import { consentHub } from '../hub/namespace.ts';
import { cookie, setCookie } from '../admin/sessions.ts';
import { randomSecret, sha256 } from '../http/crypto.ts';
import { HttpError, json } from '../http/responses.ts';
const COOKIE = 'dotx-consent';
const redirect = (location: string, headers?: HeadersInit) =>
  new Response(null, {
    status: 303,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      ...Object.fromEntries(new Headers(headers)),
      Location: location,
    },
  });
export async function consent(request: Request, env: Env) {
  const url = new URL(request.url),
    service = consentHub(env);
  if (request.method === 'GET' && url.pathname === '/oauth/consent') {
    const binding = cookie(request, COOKIE);
    if (!binding) throw new HttpError(400, 'AUTHORIZATION_EXPIRED');
    return json(
      await service.consentContext(
        url.searchParams.get('transaction') ?? '',
        await sha256(binding),
      ),
    );
  }
  if (request.method === 'GET') {
    try {
      const auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      if (auth.codeChallengeMethod !== 'S256' || !auth.codeChallenge)
        throw new HttpError(400, 'PKCE_S256_REQUIRED');
      const description = await env.OAUTH_PROVIDER.describeConsent(auth),
        binding = cookie(request, COOKIE) ?? randomSecret();
      const transaction = await service.createConsent(auth, description, await sha256(binding));
      return redirect('/authorize?transaction=' + transaction, {
        'Set-Cookie': setCookie(env, COOKIE, binding, 600),
      });
    } catch (error) {
      if (error instanceof AuthorizationError)
        throw new HttpError(
          400,
          'OAUTH_REQUEST_INVALID',
          'Return to your client to start authorization again.',
        );
      if (error instanceof CimdFetchError)
        throw new HttpError(
          502,
          'OAUTH_CLIENT_METADATA_UNAVAILABLE',
          'The client metadata could not be verified. Retry from the client.',
        );
      throw error;
    }
  }
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
  if (request.headers.get('Origin') !== env.PUBLIC_ORIGIN) throw new HttpError(403, 'BAD_ORIGIN');
  const form = new URLSearchParams(await request.text()),
    id = form.get('transaction') ?? '',
    binding = await sha256(cookie(request, COOKIE) ?? '');
  const wantsJson = request.headers.get('Accept')?.includes('application/json');
  const finish = (location: string) =>
    wantsJson ? json({ redirect: location }) : redirect(location);
  if (form.get('decision') === 'deny') return finish(await service.cancelConsent(id, binding));
  if (form.get('decision') !== 'finish') throw new HttpError(400, 'INVALID_DECISION');
  const transaction = await service.reserveConsent(id, binding);
  if (transaction.phase === 'complete') return finish(transaction.redirect!);
  const result = await env.OAUTH_PROVIDER.completeAuthorization({
    request: transaction.request,
    userId: transaction.agent_id!,
    metadata: { agent_id: transaction.agent_id },
    scope: transaction.request.scope.filter((scope) => scope === 'offline_access'),
    props: { agent_id: transaction.agent_id },
    revokeExistingGrants: false,
  });
  return finish(await service.completeConsent(id, binding, result.redirectTo));
}
