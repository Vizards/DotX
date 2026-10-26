# Connect or update Cue

Use this guide for one Cue instance connecting to an existing DotX Server. Reuse its existing connection row when reconnecting. Read [authorization](../authorization.md) for code delivery, expiry and recovery; check [management access](../../common/access.md) only when creating or reissuing the connection.

## Prepare the connection

1. Obtain the Server origin. Read `/branding/metadata.json` and `/branding/icon.png` for its public name, description and icon. The endpoint is `HTTPS_ORIGIN/mcp`, with no credentials in its URL. Inspect the actual endpoint of any existing Cue integration before reusing it. A catalog entry named “dotx” does not establish that it belongs to this Server; create a custom remote MCP connection with the exact URL when its target cannot be verified.
2. Create a named Personal Agent row in `/admin/agents` or through the Server management CLI. Reissue the existing row for this same Cue instance; create a new row only for another instance.
3. Obtain the access code and actual expiry from the administrator before opening authorization. If you cannot manage the Server, hand off this specific create/reissue action and continue after the code is available through the intended enrollment flow.

## Add the remote MCP and authorize

Use Cue's available connection tools if exposed; inspect their current schemas first. Otherwise, ask Cue to add the public MCP endpoint. For example, with the real origin substituted:

```text
Connect to the DotX remote MCP server at HTTPS_ORIGIN/mcp using OAuth.
Show me the connection or authorization action needed to finish adding it.
After connection, call list_connections and report whether a Codex is usable.
```

This message contains no access code. In the observed Cue 1.1.3 flow, Cue presents an add-remote-MCP card; **Continue** opens browser authorization. Existing apps can be inspected from **Settings → Apps**. If no connection action is offered, inspect the available Apps controls or hand off the visible missing step; do not invent a hidden configuration file or button.

When presenting that action to the intended user, provide the target Server, access code and actual expiry together: “Open this connection action, enter this code on your DotX page, approve, then return to Cue.” Keep the code separate from the URL and outside general handoff/diagnostic records. Do not send the user to an access-code form before they have its code.

1. Start authorization from Cue's remote MCP connection action. An Agent without browser control can give the user Cue's generated authorization link. Keep the original Cue flow open for its callback.
2. On DotX's page, verify the intended service, client and callback, enter the access code and approve. Cue has identified its OAuth client as **Manus**, with a `manus.im` callback in prior validation; these labels explain that flow, not a replacement for checking the current transaction.
3. Complete the normal browser return to Cue, including **Open Cue.app** when prompted. The connection card should show **Added** and authentication should complete. Cue handles the token exchange and later renewal.
4. Ask Cue to make an actual read-only `list_connections` call through this connection. Any first authenticated MCP request activates authorization; this call verifies device availability too. If there is no usable Codex, continue [the missing prerequisite](../../common/handoff.md#check-the-stage-you-completed).

A browser success page or Cue's statement that authentication finished is not a substitute for the actual MCP result. Do not invent a direct code-to-token exchange or put the code into the URL.

## Configuration and catalog updates

Keep one Cue instance on one row per Server. Local renaming does not require another row or new authorization.

When the selected release changes `remote_catalog`, open **Settings → Apps** and inspect the existing connection's **Manage** controls for a supported catalog refresh/reload action. Use it if present, then check the tools visible in Cue and make a read-only call. **Remove** uninstalls the connection; it is not a catalog-refresh control.

The exact catalog-refresh control is not established for every Cue version. If the current client exposes no such action, report the Cue version, available controls and stale tool declarations, and hand off that client capability gap. Do not claim a refresh succeeded or remove/recreate the connection just to force one. No catalog change means no refresh solely because a release exists.

If authorization fails, use [the common recovery flow](../authorization.md#recover-an-interruption). Reissue the existing row only when reauthorization is needed, then repeat Cue's normal browser flow. Native work may continue across reauthorization; [read its current state before resending](../authorization.md#after-reauthorization).

Finish with [checks and handoff](../../common/handoff.md).
