# Connect or update dot

Use for a dot instance in ChatGPT. Need: an existing Server URL; otherwise [install Server](../../server/install.md) first. Complete: the actual dot can call `list_connections` and identify a usable Codex.

## Configure and authorize

1. Read the Server's `/branding/metadata.json` for name/description and `/branding/icon.png` for its icon. The MCP endpoint is `HTTPS_ORIGIN/mcp`.
2. For a working existing connection, go directly to the read-only check in step 5. For a new connection or required reauthorization, [obtain an access code](../access-code.md), then return here. Have its real deadline available before opening OAuth.
3. Inspect the actual available plugin-creation tools. If present, use their current schema. Otherwise use [ChatGPT Plugins](https://chatgpt.com/plugins) → **+ / Add → Add custom MCP server** yourself or hand off this exact UI step. Set the verified MCP URL and **OAuth**, then **Create as a plugin** and connect/install it. Keep automatically discovered metadata/registration settings, including CIMD when offered. If manual registration mode is required, use Dynamic Client Registration. Leave business scopes empty; the client may request `offline_access`. No invented client ID/secret is needed.
4. Give the user the connection action with its access code and deadline. On the DotX page, verify the target service/client/callback, enter the code and approve. ChatGPT handles the callback and token exchange. If interrupted, use [OAuth recovery](../authorization.md#recover-an-interruption), then return here.
5. Select the plugin in the dot that will actually use it and call `list_connections`. If its tools are missing, follow the loading steps below. OAuth success alone is not this check.

When UI labels differ, inspect the current controls or [official custom MCP instructions](https://developers.openai.com/api/docs/guides/custom-mcp-server#how-to-use). Reuse the plugin and Server row for this instance; do not create extras to repair loading.

## Tools missing or catalog changed

Use for a new connection whose tools are absent, or an update with `changes.remote_catalog=true`.

1. Verify the intended plugin is installed/connected. Use **Refresh** in its ChatGPT settings/details, or the equivalent supported plugin tool.
2. Select it in the actual dot and rediscover tools. If a fresh conversation sees them but this dot does not, use dot's normal **Restart** when appropriate.
3. Make a read-only `list_connections` call. Preserve the existing OAuth connection; loading recovery does not require another access code.

## If blocked

| Observed problem | Next action |
| --- | --- |
| Browser/plugin tools unavailable | Hand off only the visible configuration, consent or refresh step |
| “Custom apps aren't allowed in this context” | Preserve configuration and the error; use an allowed context or ask the user to resolve the restriction. Do not change workspace security settings unasked |
| dot refuses before dispatching a call | Report that no DotX execution occurred. Do not broaden Codex permissions or reinstall to fix client routing |
| MCP works but no usable Codex | [Check device state](../../troubleshooting/device.md), then repeat `list_connections` |

After the real call succeeds, [continue or close the installation](../../common/handoff.md).
