import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';

// Only external Cloudflare and public relay HTTP responses are substituted. Worker auth, sessions,
// OAuth Provider and DO storage execute unchanged in the local runtime.
export function cloudflareFixture(
  t: TestContext,
  membershipResponse: 'list' | 'detail' | 'paginated',
) {
  const member: { id: string; status: string; account: { id: string }; policies: unknown[] } = {
    id: 'test-member',
    status: 'accepted',
    account: { id: 'test-account' },
    policies: [
      // Unrelated restrictions must not prevent this fixture's administrator
      // from preparing the connections exercised through the public MCP.
      {
        access: 'deny',
        permission_groups: [{ id: 'e99ac7f52b564790946ff5606061979d' }],
        resource_groups: [
          {
            scope: {
              key: 'com.cloudflare.edge.worker.script.other-worker',
              objects: [{ key: '*' }],
              subset_of: [{ key: 'com.cloudflare.api.account.test-account' }],
            },
          },
        ],
        unrelated_constraint: true,
      },
      {
        access: 'deny',
        permission_groups: [{ id: 'synthetic-other-service-permission' }],
        resource_groups: [
          { scope: { key: 'com.cloudflare.api.account.test-account', objects: [{ key: '*' }] } },
        ],
      },
      {
        access: 'allow',
        permission_groups: [{ id: '8e23b19e4e0d44c29d239c5688ba8cbb' }],
        resource_groups: [
          { scope: { key: 'com.cloudflare.api.account.test-account', objects: [{ key: '*' }] } },
          {
            scope: {
              key: 'com.cloudflare.api.account.other-account',
              objects: [{ key: '*' }],
              unrelated_constraint: true,
            },
          },
        ],
      },
    ],
  };

  const fixture = {
    member,
    membershipResponse,
    clientId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    authorizations: [] as {
      state: string;
      code_challenge: string;
      code: string;
      assertion: string;
    }[],
    tokens: new Map<string, { refresh: string; active: boolean }>(),
    usedCodes: new Set<string>(),
    expiresIn: 3600,
    refreshStatus: 200,
    refreshWait: undefined as (() => Promise<void>) | undefined,
    browserAudience: undefined as string | undefined,
    browserSubject: 'test-user',
    browserIssuer: 'https://dash.cloudflare.com',
    refreshCount: 0,
    issuedCount: 0,
    relayStatus: 200,
    status: 200,
    calls: [] as { url: URL; authorization: string | null; body: URLSearchParams }[],
  };
  const outgoing = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === 'https://oauth.dotx.run') {
      if (fixture.relayStatus !== 200) return Response.json({}, { status: fixture.relayStatus });
      if (url.pathname === '/.well-known/oauth-relay')
        return Response.json({ version: 1, client_id: fixture.clientId });
      if (url.pathname === '/register') {
        const { assertion } = (await request.json()) as { assertion: string };
        const claim = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString());
        const code = 'synthetic-code-' + fixture.authorizations.length;
        fixture.authorizations.push({ ...claim, code, assertion });
        return Response.json({
          authorization_url: 'https://oauth.dotx.run/start?ticket=synthetic',
        });
      }
      return Response.json({}, { status: 404 });
    }
    if (!['dash.cloudflare.com', 'api.cloudflare.com'].includes(url.hostname))
      return outgoing(input, init);
    const authorization = request.headers.get('Authorization');
    const body = new URLSearchParams(await request.text());
    fixture.calls.push({ url, authorization, body });
    if (fixture.status !== 200)
      return Response.json({ success: false }, { status: fixture.status });
    if (url.pathname === '/oauth2/token') {
      if (body.get('client_id') !== fixture.clientId)
        return Response.json({ error: 'invalid_client' }, { status: 400 });
      if (body.get('grant_type') === 'authorization_code') {
        const code = body.get('code')!;
        const flow = fixture.authorizations.find((flow) => flow.code === code);
        const challenge = createHash('sha256')
          .update(body.get('code_verifier') ?? '')
          .digest('base64url');
        if (
          !flow ||
          fixture.usedCodes.has(code) ||
          challenge !== flow.code_challenge ||
          body.get('redirect_uri') !== 'https://oauth.dotx.run/callback'
        )
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        fixture.usedCodes.add(code);
      } else if (body.get('grant_type') === 'refresh_token') {
        fixture.refreshCount++;
        await fixture.refreshWait?.();
        if (fixture.refreshStatus !== 200)
          return Response.json({ error: 'invalid_grant' }, { status: fixture.refreshStatus });
        const previous = [...fixture.tokens.entries()].find(
          ([, value]) => value.refresh === body.get('refresh_token'),
        );
        if (!previous) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        previous[1].active = false;
        previous[1].refresh = '';
      } else return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
      const index = ++fixture.issuedCount;
      const access = 'synthetic-browser-access-' + index,
        refresh = 'synthetic-refresh-' + index;
      fixture.tokens.set(access, { refresh, active: true });
      return Response.json({
        access_token: access,
        refresh_token: refresh,
        token_type: 'bearer',
        expires_in: fixture.expiresIn,
      });
    }
    if (url.pathname === '/oauth2/revoke') {
      for (const [key, value] of fixture.tokens)
        if (key === body.get('token') || value.refresh === body.get('token')) value.active = false;
      return new Response(null, { status: 200 });
    }
    const token = authorization?.replace(/^Bearer /, '') ?? '';
    const cli = token === 'synthetic-wrangler-oauth';
    if (!cli && !fixture.tokens.get(token)?.active)
      return Response.json({ success: false }, { status: 401 });
    if (url.pathname === '/oauth2/userinfo')
      return Response.json({
        iss: cli ? 'https://dash.cloudflare.com' : fixture.browserIssuer,
        aud: cli
          ? '54d11594-84e4-41aa-b438-e81b8fa78ee7'
          : (fixture.browserAudience ?? fixture.clientId),
        sub: cli ? 'test-user' : fixture.browserSubject,
      });
    if (url.pathname === '/client/v4/user')
      return Response.json({ success: true, result: { email: 'synthetic@example.com' } });
    if (url.pathname === '/client/v4/memberships') {
      if (fixture.membershipResponse === 'paginated') {
        const page = Number(url.searchParams.get('page'));
        // Target account is on page two; page three is deliberately unavailable.
        // Use CF's documented total_count without relying on total_pages.
        if (page !== 1 && page !== 2) return Response.json({ success: false }, { status: 503 });
        const result = Array.from({ length: 50 }, (_, index) => ({
          ...fixture.member,
          id: `other-member-${page}-${index}`,
          account: { id: `other-account-${page}-${index}` },
        }));
        if (page === 2) result[0] = fixture.member;
        return Response.json({ success: true, result, result_info: { total_count: 101 } });
      }
      const listed =
        fixture.membershipResponse === 'detail'
          ? {
              id: fixture.member.id,
              status: fixture.member.status,
              account: fixture.member.account,
            }
          : fixture.member;
      return Response.json({ success: true, result: [listed], result_info: { total_count: 1 } });
    }
    if (
      fixture.membershipResponse === 'detail' &&
      url.pathname === '/client/v4/memberships/test-member'
    )
      return Response.json({ success: true, result: fixture.member });
    return Response.json({ success: false }, { status: 404 });
  });
  return fixture;
}
