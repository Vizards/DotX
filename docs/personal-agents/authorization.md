# Personal Agent OAuth recovery and lifetimes

Use for an observed authorization problem or a question about expiry. Normal connection starts in the [dot](dot/index.md) or [Cue](cue/index.md) guide. Their OAuth clients store/exchange/refresh credentials; the Agent does not handle raw tokens or schedule keepalive calls.

## Recover an interruption

| Current state | Action and return point |
| --- | --- |
| No access code | [Obtain it](access-code.md), then return to the client's authorization action |
| Mistyped access code | Correct it on the same page; an error does not consume the invitation. Retry immediately while attempt budget remains |
| Code checks exhausted | Wait for the page's remaining window; retry the same unexpired code/transaction. Extra submissions do not extend the window; reissuing cannot bypass it |
| Authorization page expired | Restart OAuth from the client. An unused code may still be valid; replace it only if no longer usable |
| Code consumed but client cannot finish | [Reissue on the same Server row](access-code.md), then repeat the client's OAuth flow |
| Access token expired | Let the client refresh normally; do not immediately request another access code |
| Refresh rejected, authorization revoked/replaced, or credentials lost | Inspect the actual error; if reauthorization is required, obtain a new code for that same row and complete client OAuth |
| Client registration invalid | Let the client's normal registration/reconnection flow recover; keep the DotX row |
| Network/service failure | Preserve the failure and retry when appropriate; it does not establish revoked permission |
| OAuth succeeded but tools missing | Use [dot loading recovery](dot/index.md#tools-missing-or-catalog-changed) or Cue's visible connection controls; do not reissue solely for catalog loading |

After recovery, make the client's real `list_connections` check. For replacement authorization, also perform the checks below before resuming native work.

## Normal use and renewal

| Item | Behavior |
| --- | --- |
| Access code | 30 minutes from issuance; actual `expires_at` governs. Six characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`; case and surrounding whitespace ignored |
| Code checks | Ten new checks per Server per 60 seconds, shared by applicants. Existing MCP calls, token refresh and device connections are unaffected |
| Browser authorization transaction | Ten minutes from creation, independently of the access code. The page shows its actual deadline |
| OAuth authorization code | Client exchanges it automatically; provider allows ten minutes. It is distinct from the human-entered access code |
| Access token | Normally one hour; OAuth `expires_in` is authoritative |
| Refresh authorization | Initially 30 days; each successful refresh extends it to 30 days from that refresh. Chat activity/MCP calls alone do not prove renewal |
| Dynamically registered client | 90-day registration, renewed during successful token exchanges when due; CIMD clients do not use this stored registration |

The access code's expiry does not limit the connection after enrollment. Administrators can revoke/replace authorization earlier. The provider does not expose the refresh policy in the token response; this guide supplies it.

DotX has no configurable PA read/write scopes. An approved connection can use all seven tools and every approved Codex; native task permissions still apply. Leave business scopes empty; the client may request `offline_access` for renewal.

## After reauthorization

One instance keeps one Server row. Reissuing ends its previous unfinished enrollment but leaves active access working until the new token first authenticates to MCP. That request replaces the old grant. Old receipts, tracking access and subscriptions do not transfer; native tasks continue. Ordinary token refresh does not replace the grant.

1. Discover current connections and runtime IDs.
2. Read actual conversation/turn state before sending work. Do not resend uncertain work to recreate a receipt.
3. Explicitly [follow and subscribe](../usage/interactions.md) to a current turn when needed, then return to the user's task.
