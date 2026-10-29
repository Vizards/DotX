# Personal Agent OAuth recovery and lifetimes

Use for an observed authorization problem or expiry question. Start a new connection with [Connect a Personal Agent](index.md). The client's OAuth implementation stores, exchanges and refreshes credentials.

## Recover an interruption

| Current state | Action and return point |
| --- | --- |
| Waiting for approval | [Approve the request](approval.md), then return to the original authorization page. It checks the result and continues automatically, including when approval happened on another computer |
| Signed in or completed browser setup in another tab | Return to the original authorization page in that browser; it detects the session. Select **Allow connection** unless an administrator already approved the request |
| Page closed | Reopen the same URL in the same browser while the request is valid. Approval is retained; the page continues automatically |
| Original browser cookie lost, request expired, rejected or removed | Start OAuth again from the client; get approval for the new request |
| Access token expired | Let the client refresh normally; do not request reauthorization solely for expiry |
| Refresh rejected or credentials lost | Inspect the actual error. If needed, start OAuth again and [approve the new request](approval.md) |
| Connection removed | New approval is required; approval creates a new record |
| Client registration invalid | Let the client's normal registration flow recover; a new approved authorization creates a new DotX row |
| Network/service failure | Preserve the failure and retry the same request when appropriate. It does not establish revoked permission |
| Approval succeeded but callback interrupted | Retry **Continue to client** on the original page. If it reports authorization interrupted, restart OAuth from the client |
| OAuth succeeded but tools missing | [Refresh the client's tools](index.md#refresh-tools), then repeat `list_connections` |

After recovery, make the client's real `list_connections` check. After a new authorization, also perform the checks below before resuming native work.

## Normal use and renewal

| Item | Behavior |
| --- | --- |
| Browser authorization request | Ten minutes from creation; the page shows its deadline. Approval does not extend it |
| OAuth authorization code | Client exchanges it automatically; provider allows ten minutes |
| Access token | Normally one hour; OAuth `expires_in` is authoritative |
| Refresh authorization | Initially 30 days; each successful refresh extends it to 30 days from that refresh. MCP calls alone do not prove renewal |
| Dynamically registered client | 90-day registration, renewed during successful token exchanges when due; CIMD clients do not use this stored registration |

The request's expiry does not limit a completed connection. Administrators can revoke authorization earlier. DotX has no configurable PA read/write scopes. An approved connection can use all seven tools and every approved Codex; native task permissions still apply. Leave business scopes empty; the client may request `offline_access` for renewal.

## After reauthorization

Every newly approved OAuth request creates an independent Server connection. Old connections and their access remain valid until removed or expired; remove an obsolete connection explicitly after checking the new one. Old receipts, tracking access and subscriptions do not transfer to the new connection; native tasks continue. Ordinary token refresh stays within the same connection and does not create another row.

1. Discover current connections and runtime IDs.
2. Read actual conversation/turn state before sending work. Do not resend uncertain work to recreate a receipt.
3. Explicitly [follow and subscribe](../usage/interactions.md) to a current turn when needed, then return to the user's task.
