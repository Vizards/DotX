# Recover browser management access

Use for a failure signing in to this Server's `/admin` or continuing an authenticated management action. Need: the Server URL, original task/approval URL and observed error. For Personal Agent OAuth token or callback failures, use [PA OAuth recovery](../personal-agents/authorization.md#recover-an-interruption). Complete: browser management works and the original action can continue, or the exact missing access is handed off.

## Choose by the actual failure

| Observed result | Next action |
| --- | --- |
| `CF_LOGIN_EXPIRED`, cancelled authorization or a failed initial login | Return to the original management/approval URL and start a new login. An expired or consumed authorization code cannot be reused by repeatedly refreshing the callback |
| `CF_LOGIN_REQUIRED`, `CF_IDENTITY_INVALID` or an expired browser session | Sign in again using an available method. If permission is then denied, follow the next row |
| `NOT_A_TARGET_ACCOUNT_MEMBER`, `TARGET_WORKER_MANAGEMENT_REQUIRED` or `CF_ACCESS_DENIED` | [Identify an authorized login](../server/browser-login.md#identify-the-cloudflare-login) and verify direct management permission for this account and Worker. Repeating login with unchanged permissions does not grant access; group-only permission is unsupported |
| `CF_RELAY_UNAVAILABLE` or `CF_UNAVAILABLE` during initial login | Preserve the upstream error and retry a new login later. Use an already configured password/Passkey if available. Do not reset credentials or recreate the service to fix an upstream outage |
| Temporary Cloudflare failure during an established session | Retry the management read later; the temporary failure alone does not delete the session. Read current state before retrying an uncertain write |
| `MANAGEMENT_NOT_CONFIGURED` | Have the installation Agent verify the existing deployment's `CF_ACCOUNT_ID` and `CF_WORKER_ID` against [its configuration](../server/configuration.md). Preserve service identity and storage |
| `LOGIN_ATTEMPTS_EXHAUSTED` / HTTP 429 | Wait for the returned `retry_after_seconds` or displayed retry window. Starting from another browser or changing local credentials does not reset the Server's budget |
| Local password/Passkey unavailable or forgotten | If Cloudflare or another method works, sign in and use `/admin/security`. Otherwise follow [explicit local-credential recovery](#recover-local-credentials) |

Cloudflare login starts have their own per-Server budget: ten attempts per fixed 60-second window, including failed starts. Existing callbacks do not spend another start attempt. Password attempts and Passkey login starts share a separate ten-attempt budget; exhausting the Cloudflare budget does not consume that local-login budget.

## Recover local credentials

Use this branch when the user needs a password/Passkey setup or reset, not to repair Cloudflare account permissions.

1. An Agent verifies [Wrangler management access](../common/access.md) for this Server. Browser login and a PA's MCP grant are not substitutes for that CLI authority.
2. Use `node /ABSOLUTE/RELEASE/admin.mjs --url HTTPS_ORIGIN setup` for an installation without local credentials. For an explicitly requested replacement of existing credentials, use `node /ABSOLUTE/RELEASE/admin.mjs --url HTTPS_ORIGIN reset-login`. **Having trouble?** on the login page provides a copyable request for that installation Agent.
3. Give the private link only to the intended administrator. They choose the password or Passkey on their DotX page; the Agent never receives it. Links last 24 hours; issuing another replaces the unfinished link. If a response was lost, read `setup-status` and confirm the user's result before issuing another.
4. Existing credentials keep working until reset completion. Completion replaces the old password and Passkeys and ends other browser sessions. It preserves Codex devices, PA connections and business storage. Verify the saved local method with `setup-status` and actual browser access, then return to the original action.

`configured` reports whether local credentials exist; `initialized` records prior browser-management use. A Cloudflare-only installation can be initialized with `configured=false`; this is not a failed setup. Removing the last local method does not reset the installation.

## Return to the original action

Keep the original device/PA request identity. Successful login or credential recovery does not approve it: [approve the device](../codex/approve.md) or [approve the PA request](../personal-agents/approval.md) explicitly. If that request has expired independently, follow its own reapplication/OAuth recovery route. Report management access and completion of the requested action separately.
