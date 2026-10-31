# Connect or update Muse

Use for a Muse personal agent (Meta AI) running in its hosted workspace. Need: an existing Server URL; ask the user if missing. Server deployment or upgrade is a separate user request. Complete: Muse calls `list_connections` through that Server and identifies a usable Codex.

## Configure and authorize

Observed with DotX 0.1.0 (wire 5), verified end to end on 2026-10-30.

1. Use the exact endpoint `HTTPS_ORIGIN/mcp`. Muse has no ready-made recipe in the observed version; the working route is a small connector Muse creates and runs in its own workspace: a script that speaks MCP Streamable HTTP plus OAuth, kept with its registration and tokens in a private connector directory (file mode `0600`). Reuse an existing connector only when its target Server is verified.
2. Request `HTTPS_ORIGIN/mcp` without credentials and follow `resource_metadata` in the `401` response's `WWW-Authenticate` header (currently `/.well-known/oauth-protected-resource/mcp`). Use its `authorization_servers` entry to discover the authorization-server metadata. The issuer, `/authorize`, `/oauth/token` and `/oauth/register` are all on the Server origin; `offline_access` is the only scope offered.
3. Register through Dynamic Client Registration with a loopback redirect URI (for example `http://localhost:53682/dotx-callback`) and start the authorization flow with PKCE (`S256`) and the `resource` parameter set to the MCP endpoint. Keep the `state` and code verifier with the pending request.
4. Ask the user to open the authorization URL in their own browser. Opening it queues a pending Personal Agent request on the Server. [Have the request approved](../approval.md), then return here. The loopback callback points to the user's computer, so this connector in Muse's VM needs the user to relay it. After approval the browser shows an expected connection error; ask the user to paste the full callback URL from the address bar.
5. Exchange the pasted `code` at `/oauth/token` with the stored code verifier, checking `state` first. Store the returned tokens only in the connector's private token file, never in chat or memory. The access token lasts one hour; renew it with the refresh token automatically.
6. Through the connector, run MCP `initialize` and `tools/list`: the seven DotX Remote tools should appear. Call `list_connections` and identify a usable Codex. OAuth success alone is not this check.

## If blocked

| Observed problem                                                                 | Next action                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Callback page cannot be reached                                                  | Expected for a loopback redirect outside Muse's workspace. Use the callback URL the user pasted from their browser; do not try to open it inside Muse                                               |
| Page closed or reopened | Resume the same `/authorize?transaction=...` URL in the same browser while valid. Opening the original OAuth authorization URL creates a new request |
| Request expired or browser cookie lost | [Recover authorization](../authorization.md#recover-an-interruption), then return to step 4 |
| `tools/list` returns fewer than seven tools                                      | Re-run `tools/list` through the connector and rediscover; do not reauthorize for a catalog problem alone                                                                                             |
| Token exchange or refresh fails                                                  | Check the stored client registration and Server origin. If the grant was revoked, repeat from step 3 and approve the new request                                                                     |
| MCP works but no usable Codex                                                    | [Check device state](../../troubleshooting/device.md), then repeat step 6                                                                                                                            |

After successful verification, [continue and offer to share the setup experience](../index.md#after-connection).

## Refresh after an update

When `changes.remote_catalog=true`, re-run `tools/list` through the existing connector, rediscover the DotX Remote tools and make a read-only `list_connections` call. The stored OAuth grant keeps working; no reauthorization is needed for a catalog change. If the Server itself was replaced, verify the connector's stored origin before reuse and treat a different origin as a new connection.
