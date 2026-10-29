# Server integration tests

Run from the repository root:

```sh
pnpm test
pnpm --filter @dotx/server exec node --test --test-timeout=30000 'test/admin/*.test.ts'
```

The normal test command discovers `test/**/*.test.ts`, including new subdirectories.

| Directory | Responsibility |
| --- | --- |
| `mcp/` | MCP discovery, tools, device visibility, calls/receipts, events, retention and update hints |
| `admin/` | Public management APIs and target Worker authority |
| `oauth/` | Personal Agent requests and approval, cancellation, PKCE and token exchange |
| `http/` | Declared pages, API errors, static-asset routing and response headers |
| `support/` | Shared local runtime, synthetic external CF responses and HTTP client steps |

All suites run the production Worker with disposable local KV/DO storage. Assertions use public HTTP/MCP responses. They do not call internal classes or read private storage. The Cloudflare fixture substitutes external identity and membership responses; it is not proof of live CF behavior. Device peers only exchange DotX wire envelopes and opaque results, never simulated Codex/ChatGPT behavior.

Passkey rename coverage registers and authenticates a generated key through public WebAuthn endpoints with real signatures. It checks the Server contract; it does not establish physical authenticator or browser UX compatibility.

`support/server.ts` owns the runtime and existing MCP/device helpers. `cloudflare.ts` controls external CF responses and records synthetic requests; `browser.ts` extracts response cookies; `oauth.ts` drives a generic Personal Agent OAuth client. Protocol failures belong in their public-interface suites. Reuse the existing MCP authorization-switch/refresh/revocation tests instead of repeating them in OAuth tests.

HTTP routing tests use the full asset router with temporary HTML/JS fixtures and the real public branding/header files. They verify dispatch, not React rendering or the release build. A deliberately mismatched public origin makes any Worker execution fail; successful assets therefore demonstrate Worker bypass without a test Worker. Other suites use the Worker export to retain opaque device WebSocket responses and avoid development proxy rewrites.

Tests default to 30 seconds each. The Claim attempt-window test allows 90 seconds because it waits for the actual 60-second window; it does not change the runtime clock or production limits. New suites use no live credentials or external accounts.

Real Cloudflare policy compatibility, browser/client behavior and native Codex integration are checked separately against real installations using maintainer procedures in Notion. These automated results do not replace that acceptance.
