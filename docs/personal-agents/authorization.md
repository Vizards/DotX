# Personal Agent authorization, expiry and recovery

Read this common guide with the selected client's [dot](dot/index.md) or [Cue](cue/index.md) instructions. These rules apply to the Personal Agent's MCP connection, not administrator password/passkey login. The client's OAuth implementation stores credentials, exchanges authorization codes and refreshes tokens; the Agent explains the workflow and helps recover failures. Do not read or copy raw tokens, schedule model-driven renewal, or send keepalive tool calls to preserve authorization.

## Deliver an access code

Obtain the intended connection's access code and its actual `expires_at` from the administrator's response or code panel. Deliver the code only through the intended enrollment flow, together with the target MCP URL and that deadline, including the date and timezone. The code lasts 30 minutes from issuance; forwarding it does not restart the clock. If the deadline is unavailable, state that it is unknown rather than inventing 30 minutes from receipt. Normal authorization can still report whether the code is usable.

The access code is not an OAuth token or the protocol's authorization code. Enter it only on the authorization page opened by the client's normal OAuth flow; never put it in the MCP URL. Once enrollment succeeds, the original code's deadline no longer limits the connection. General handoffs and diagnostic records must not contain codes or credentials.

New codes contain six characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`; letter case and surrounding whitespace do not matter. A mistyped code can be corrected and submitted immediately without consuming the invitation. Each Server allows ten new code checks in a 60-second window shared by all applicants. If exhausted, the page reports the remaining wait; extra submissions do not extend it. Wait and retry the same unexpired code and authorization. Do not reissue or start another browser flow to bypass the wait. This budget does not apply to existing MCP access, token refresh or device connections.

## Complete the browser step

DotX has no configurable read/write permissions for Personal Agent connections. An approved connection with valid OAuth credentials can use all seven MCP tools and every approved Codex on this Server. Leave business scopes empty; the client may request the advertised `offline_access` scope for renewal. Native Codex permissions still apply to each task.

The authorization page shows the current transaction's deadline, from the Server's `expires_at`. This transaction lasts 10 minutes from creation, independently of the access code's deadline. After it expires, return to the client and start authorization again. An unused code may still be valid; if the code was already consumed and the flow cannot continue, reissue on the existing connection.

After approval, the client receives a short-lived OAuth authorization code and exchanges it automatically. The provider gives that code 10 minutes; do not ask the user to copy it or manage a timer. Verify enrollment with an authenticated MCP request, then check for usable Codex devices using [completion checks](../common/handoff.md).

## Normal use and renewal

| Item | Current behavior | What the Agent should do |
| --- | --- | --- |
| Access token | Normally 1 hour; the token response's `expires_in` is authoritative | Let the client refresh it. Expiry alone does not require a new access code |
| Refresh authorization | Initially 30 days; each successful refresh moves expiry to 30 days from that refresh | More than 30 days without successful refresh requires reauthorization. Conversation activity or MCP calls alone do not prove renewal |
| Dynamically registered client | 90-day registration, renewed by the provider during successful token exchanges when due | Let the client's OAuth flow handle registration. This does not require reconnection every 90 days; CIMD clients do not use this stored registration |

Normal refresh preserves the same connection and authorization. Administrator revocation or replacement can end access earlier. The current provider returns access-token expiry through OAuth; it does not return the 30-day refresh policy in the token response. This versioned guide supplies that policy without exposing credentials to the model.

## Recover an interruption

- An access token expires: let the client's standard OAuth refresh run. Do not immediately ask for another access code.
- Refresh is rejected, authorization is revoked/replaced, or credentials are lost: inspect the client's error, obtain a new code for the existing connection when reauthorization is needed, and follow that client's normal OAuth flow. Do not create another connection for the same instance.
- Client registration is invalid: use the client's normal registration/reconnection flow; the DotX connection row remains the same.
- The authorization page or code has expired: restart from the client and obtain a replacement code only when the existing one is no longer usable.
- The service is busy or temporarily unreachable: report the failure and retry when appropriate. Do not treat network errors as revoked permission or automatically reissue codes.

Use the selected client's guide for configuration and refresh controls. After recovery, follow the checks below before resuming native work.

## After reauthorization

One Personal Agent instance retains one connection row. Reissuing ends its previous unfinished enrollment and preserves the current active authorization until the new token first authenticates to MCP. That first authenticated request replaces the old grant; old receipts, tracking access and subscriptions do not transfer. Native Codex tasks continue.

1. Discover current connections and native runtime IDs.
2. Read the actual native conversation/turn state before sending work. Do not resend an uncertain task to recreate its receipt.
3. Explicitly follow and subscribe to the current turn if needed, using [interactions](../usage/interactions.md).

Ordinary OAuth token refresh retains the same grant and its state; these replacement steps are for reauthorization.
