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
    calls: [] as { url: URL; authorization: string | null; body: URLSearchParams }[],
  };
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
    const token = authorization?.replace(/^Bearer /, '') ?? '';
    if (token !== 'synthetic-wrangler-oauth')
      return Response.json({ success: false }, { status: 401 });
    if (url.pathname === '/oauth2/userinfo')
      return Response.json({
        iss: 'https://dash.cloudflare.com',
        aud: '54d11594-84e4-41aa-b438-e81b8fa78ee7',
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
