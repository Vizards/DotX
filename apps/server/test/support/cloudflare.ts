import type { TestContext } from 'node:test';

// Only external Cloudflare HTTP responses are substituted. Worker auth, sessions,
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
    status: 200,
    expiresIn: 3600,
    refreshStatus: 200,
    rejectedTokens: new Set<string>(),
    beforeRefresh: undefined as (() => Promise<void>) | undefined,
    calls: [] as { url: URL; authorization: string | null; body: URLSearchParams }[],
  };
  const issued = new Set<string>();
  const outgoing = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!['dash.cloudflare.com', 'api.cloudflare.com'].includes(url.hostname))
      return outgoing(input, init);
    const authorization = request.headers.get('Authorization');
    const body = new URLSearchParams(await request.text());
    fixture.calls.push({ url, authorization, body });
    if (fixture.status !== 200)
      return Response.json({ success: false }, { status: fixture.status });
    if (url.pathname === '/oauth2/token') {
      if (body.get('grant_type') === 'refresh_token') {
        await fixture.beforeRefresh?.();
        if (fixture.refreshStatus !== 200)
          return Response.json({ error: 'invalid_grant' }, { status: fixture.refreshStatus });
      }
      const access_token = 'synthetic-browser-' + issued.size;
      issued.add(access_token);
      return Response.json({
        access_token,
        refresh_token: 'synthetic-refresh-' + issued.size,
        token_type: 'Bearer',
        expires_in: fixture.expiresIn,
      });
    }
    const token = authorization?.replace(/^Bearer /, '') ?? '';
    const browser = issued.has(token);
    if ((!browser && token !== 'synthetic-wrangler-oauth') || fixture.rejectedTokens.has(token))
      return Response.json({ success: false }, { status: 401 });
    if (url.pathname === '/oauth2/userinfo')
      return Response.json({
        iss: 'https://dash.cloudflare.com',
        aud: browser ? 'synthetic-browser-client' : '54d11594-84e4-41aa-b438-e81b8fa78ee7',
        sub: 'test-user',
      });
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
