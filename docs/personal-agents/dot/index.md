# Connect or update dot

Use for a dot instance in ChatGPT. Need: an existing Server URL; ask the user if missing. Server deployment or upgrade is a separate user request. Complete: the actual dot can call `list_connections` and identify a usable Codex.

## Configure and authorize

1. Read the Server's `/branding/metadata.json` for name/description and `/branding/icon.png` for its icon. The MCP endpoint is `HTTPS_ORIGIN/mcp`.
2. For a working existing connection, go directly to step 5. Otherwise start the client's standard OAuth flow; no pre-created DotX connection is needed.
3. Inspect the actual available plugin-creation tools. If present, use their current schema. Otherwise use [ChatGPT Plugins](https://chatgpt.com/plugins) → **+ / Add → Add custom MCP server** yourself or hand off this exact UI step. Set the verified MCP URL and **OAuth**, then **Create as a plugin** and connect/install it. Keep automatically discovered metadata/registration settings, including CIMD when offered. If manual registration mode is required, use Dynamic Client Registration. Leave business scopes empty; the client may request `offline_access`. No invented client ID/secret is needed.
4. Open the connection action. On the DotX page, verify the target Server, client and callback. [Have the request approved](../approval.md), then return here. Keep the original page open: it returns to ChatGPT automatically after browser or Wrangler approval. ChatGPT handles token exchange. If interrupted, use [OAuth recovery](../authorization.md#recover-an-interruption).
5. Select the plugin in the dot that will actually use it and call `list_connections`. If its tools are missing, follow the loading steps below. OAuth success alone is not this check.

When UI labels differ, inspect the current controls or [official custom MCP instructions](https://developers.openai.com/api/docs/guides/custom-mcp-server#how-to-use). Reuse the existing ChatGPT plugin to repair loading; do not reauthorize for missing tools alone. When a new OAuth authorization is needed, approval creates a new independent DotX row; follow [OAuth recovery](../authorization.md#after-reauthorization).

## Tools missing or catalog changed

Use for a new connection whose tools are absent, or an update with `changes.remote_catalog=true`.

1. Verify the intended plugin is installed/connected. Use **Refresh** in its ChatGPT settings/details, or the equivalent supported plugin tool.
2. Select it in the actual dot and rediscover tools. If a fresh conversation sees them but this dot does not, use dot's normal **Restart** when appropriate.
3. Make a read-only `list_connections` call. Preserve the existing OAuth connection; loading recovery does not require reauthorization.

## If blocked

| Observed problem | Next action |
| --- | --- |
| Browser/plugin tools unavailable | Hand off only the visible configuration, consent or refresh step |
| “Custom apps aren't allowed in this context” | Preserve configuration and the error; use an allowed context or ask the user to resolve the restriction. Do not change workspace security settings unasked |
| dot refuses before dispatching a call | Report that no DotX execution occurred. Do not broaden Codex permissions or reinstall to fix client routing |
| MCP works but no usable Codex | [Check device state](../../troubleshooting/device.md), then repeat `list_connections` |

After the real call succeeds, [continue and offer to share the setup experience](../index.md#after-connection).
