# Connect or update Cue

Use for one Cue instance. Need: an existing Server URL; ask the user if missing. Server deployment or upgrade is a separate user request. Complete: Cue calls `list_connections` through the intended connection and identifies a usable Codex.

## Configure and authorize

1. Read the Server's `/branding/metadata.json` and `/branding/icon.png`. Use the exact endpoint `HTTPS_ORIGIN/mcp`. Reuse an existing Cue definition only when its target is verified.
2. For an already working connection, go to step 5. Otherwise continue with Cue's OAuth flow; no pre-created DotX connection is needed.
3. Inspect Cue's available connection-tool schema and configure a custom remote MCP with this URL and OAuth. Verify the operation's result and retain its connection ID. In the observed `manus-config connector ensure` behavior, an existing case-insensitive name match takes precedence over a `--file` draft: supplying a new URL does not prove it was used. If an old definition's target cannot be verified, create a distinctly named custom connection and use its returned ID for subsequent actions.
4. Open that connection's OAuth action. Cue 1.1.3 presents a **Continue** card. Verify the authorization origin is the target Worker; Cue has used client name **Manus** and a `manus.im` callback. [Have the request approved](../approval.md), then return here. Keep the original page open: it continues automatically after browser or Wrangler approval. Complete the browser return, including **Open Cue.app** when prompted. Cue handles token exchange and renewal.
5. Call `list_connections` through this connection. An actual authenticated request verifies MCP access; inspect its devices/interfaces to establish usability. A card saying **Added** or an Agent's claim of success is not sufficient.

## If blocked

| Observed problem | Next action |
| --- | --- |
| No connection tool | Inspect current **Settings → Apps** controls or hand off the exact missing UI action |
| OAuth opens another Worker | Stop before approval. Correct the selected Cue definition; do not alter the intended Server's OAuth configuration |
| Continue has no visible result | Inspect the existing card and browser state; if retrying, use the same verified Cue connection ID, not another definition |
| Approval or callback cannot finish | [Recover the OAuth request](../authorization.md#recover-an-interruption), then return to step 4 |
| MCP works but no usable Codex | [Check device state](../../troubleshooting/device.md), then repeat step 5 |

After successful verification, [continue and offer to share the setup experience](../index.md#after-connection).

## Refresh after an update

When `changes.remote_catalog=true`, inspect the existing connection's **Manage** controls under **Settings → Apps** for a supported refresh/reload action. Use it, rediscover tools and make a read-only call. **Remove** is uninstall, not refresh.

If no refresh control exists, report the client version, visible controls and stale declarations; do not invent a hidden setting or remove/recreate the connection. No catalog change means no refresh solely because a release exists. When reauthorization is actually needed, reuse the verified Cue definition; approval creates a new independent DotX row. Follow [OAuth recovery](../authorization.md#after-reauthorization).
