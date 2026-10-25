# Connect or update dot in ChatGPT

Use this guide for dot's ChatGPT custom MCP plugin. The target DotX Server must already exist. Reuse an existing plugin and connection for the same dot instance and Server. Read [authorization](../authorization.md) for code delivery, expiry and recovery; check [management access](../../common/access.md) only when creating or reissuing a connection.

## Obtain the connection information

1. Read `HTTPS_ORIGIN/branding/metadata.json` for the service name and description; its icon is `HTTPS_ORIGIN/branding/icon.png` and MCP endpoint is `HTTPS_ORIGIN/mcp`.
2. For a new instance, create a named connection in `/admin/agents` or with the Server management CLI. For reauthorization of the same instance, reissue its existing row.
3. Obtain the row's access code and actual expiry. If you lack management capability, give the administrator the intended Server, instance name and create/reissue action. Continue after they supply the code through the intended enrollment flow. Do not place it in the MCP URL or plugin configuration.

## Configure and authorize the plugin

If plugin creation tools are available, inspect their current schema and create the equivalent configuration below. Do not assume dot can create plugins merely because it can use them. Otherwise use the web flow, or give these steps to the user:

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins), choose **+ / Add**, then **Add custom MCP server**.
2. Fill the name/description from the target Worker metadata. Set Server URL to `HTTPS_ORIGIN/mcp` and authentication to **OAuth**. Keep the client's automatically discovered registration/metadata settings, including CIMD when offered. When manual registration mode is required, use Dynamic Client Registration; do not invent a client ID or secret. Leave business scopes empty; the client may request the advertised `offline_access` scope for renewal.
3. Choose **Create as a plugin**, then connect/install the resulting plugin. On the DotX authorization page, verify the intended service, client and callback, enter the access code and approve. Administrators also use this code flow. ChatGPT handles the OAuth callback and token exchange.
4. Select the installed plugin in the dot that will use it. Make a read-only `list_connections` call through that plugin. Any first authenticated MCP request activates the authorization; this call also checks the network's devices.
5. Confirm that the chosen Codex is usable with the required native interface. If none is usable, continue the specific [Codex connection or recovery step](../../common/handoff.md#check-the-stage-you-completed). A browser success page alone does not establish this result.

UI labels can change. Use the [official custom MCP instructions](https://developers.openai.com/api/docs/guides/custom-mcp-server#how-to-use) or the current creation tool's schema when the visible flow differs. Do not create extra plugin definitions to work around an unfinished installation.

## Refresh tools after an update

1. Read the selected release's `changes.remote_catalog` flag. If unchanged, no catalog refresh is needed solely because a release exists.
2. Open the existing plugin's settings/details in ChatGPT Plugins and use **Refresh**, or the equivalent supported plugin tool. Preserve the plugin and OAuth connection.
3. In the actual dot that will use it, compare visible tool declarations with the target release and make a read-only call. Server deployment alone does not refresh a conversation's cached catalog.
4. If a fresh conversation sees the updated catalog but this dot still does not, use dot's normal Restart action when appropriate and verify again. Do not delete/recreate dot as routine recovery.

When authorization itself needs recovery, follow [the common recovery flow](../authorization.md#recover-an-interruption), reissue the existing connection and repeat the browser step above. Catalog refresh alone does not require a new code. After reauthorization, inspect native work before resending it; [old receipts and subscriptions do not transfer](../authorization.md#after-reauthorization).

## Handle a client-side blocker

- **Browser/tool access unavailable:** perform the preparation you can and hand off the exact creation, consent or Refresh step. Respect saved permissions; do not edit permission files or bypass them.
- **Custom apps aren't allowed in this context:** preserve the configuration and platform error. Use an allowed ChatGPT context or let the user resolve the workspace restriction. This is not proof of broken DotX OAuth discovery; do not change workspace security settings without authorization.
- **dot refuses before dispatching an MCP call:** report that no DotX execution request occurred. Do not reinstall DotX or broaden Codex permissions to fix a client routing refusal. The user can choose local Codex for that work.

Finish with [checks and handoff](../../common/handoff.md).
