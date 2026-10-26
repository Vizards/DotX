# Troubleshoot DotX

Record the available Server/Desktop versions, service URL, device ID, actual owner state and exact error. Use remote `list_connections` when connected, local `device_status` on the affected Mac, or `/health` for Server. Do not require all three before investigating. Read [access checks](../common/access.md) only for management actions. Keep tokens, private keys and conversation contents out of diagnostics.

## Authorization fails

For browser management, a 401 requires DotX password or passkey login; lost credentials follow [browser-login recovery](../common/access.md#browser-login-and-recovery). For Wrangler management, a 401 requires checking the official Wrangler login; a confirmed 403 means that identity cannot directly modify the target Worker. Group-only permission is unsupported in 0.1.0. A CF outage affects Wrangler validation, not existing browser login. Do not reset browser credentials to repair it.

For MCP, read [authorization, expiry and recovery](../personal-agents/authorization.md). Normal access-token expiry is handled by the client's OAuth refresh. When reauthorization is needed, restart the client's normal OAuth flow with a fresh access code issued for the existing connection. Do not create a second connection to repair the same instance. See the [dot](../personal-agents/dot/index.md) or [Cue](../personal-agents/cue/index.md) guide for client-specific setup.

## No usable Codex

When remote MCP is available, read `list_connections`; on the affected Mac, read `device_status`. Lack of a remote MCP connection does not itself mean the local plugin failed. If no device is enrolled, continue [Codex connection](../codex/connect.md). A pending request needs an administrator's approval. An offline device needs its local Codex host and plugin running. Read device_status on that Mac; distinguish this MCP instance from the actual owner. First-time setup activates automatically after the installation command finishes. Use the update/reset guide when intentionally replacing already loaded configuration or code.

DEVICE_PROTOCOL_MISMATCH includes the actual versions and update guidance. Coordinate the affected component updates; the owner retries with backoff. Do not re-enroll, remove state or repeatedly query to repair a version difference. Product versions alone do not establish incompatibility.

Missing or corrupt private keys/configuration require explicit recovery. Do not silently generate a new identity or choose another data directory. For an intentional reset or service change, follow [remove/reset](../maintenance/remove.md).

If an older plugin entry reports a setup error, inspect `owner` before treating the device as offline. Current status queries can read the actual owner even when the queried entry loaded before setup. A healthy owner's authenticated/approved connection is usable; `entry.diagnostic` remains that entry's earlier initialization result. In older releases whose tool returns no owner, corroborate with the package's `cli.mjs status --state` using the exact host-provided data directory and, when authorized, Server `devices`. For a missing owner, inspect setup progress and diagnostics first. Earlier releases may still need their documented host refresh after configuration; do not re-enroll or replace an identity that is already online.

For a rejected/expired application or revoked device with intact local identity, follow [Codex connection](../codex/connect.md) when the user requests reconnection. The connect command submits a new application with the existing device ID and key pair; the administrator must approve it again. Do not reset the identity merely because access was revoked, and do not automatically reapply in the background.

If setup was interrupted before the native caller ID was saved, rerun the package's connect command with the same data directory and Server. It creates another empty caller and retains the device identity and enrollment; an unused empty conversation may remain. A saved caller ID is reused when only naming or archiving was interrupted. Do not reset the plugin or search other conversations to recover this empty caller.

If App Tools reports DESKTOP_PIPE_MISSING, verify that this plugin is loaded by the desktop host and that the installed package includes its `.codex-plugin/plugin.json` environment overlay. Reinstall the complete package if needed, refresh the host MCP configuration, then check the interface again. A standalone CLI host may not provide this desktop context. Do not copy another process's pipe path or change the application's signature checks.

## The installed plugin's tool is missing

1. Check that the intended plugin is installed and enabled. Try to discover and call `device_status` in the current conversation; installation on disk alone does not prove it loaded.
2. Use the host's normal plugin loading/refresh entry when available. A native `config/mcpServer/reload` request must reach the actual host using the plugin, not an independent CLI App Server. It queues a refresh; a successful return is not proof the current conversation already has the tool. Check again when the host applies it.
3. If the current conversation still lacks the tool, try continuing in a new local Codex conversation on that Mac, selecting DotX through the normal plugin picker when needed. Give the user a short handoff containing the Server URL, selected version, installed package and completed steps. Reuse the installed plugin, host-provided data and any application already submitted. A new conversation can discover a newly installed plugin without quitting its host; verify this on the actual Desktop instead of promising that every host version behaves identically.
4. Only if normal loading and a new conversation fail, coordinate an app restart with the user. When other tasks are active, defer it rather than interrupting them. Do not kill the app, manipulate other plugin processes or globally refresh unrelated work as a routine installation step.

`SETUP_REQUIRED`, `DEVICE_SETUP_IN_PROGRESS` or `DEVICE_SETUP_INCOMPLETE` from a loaded plugin is different from a missing tool. Finish or resume the connect command, then check its automatic startup. If the command has finished but startup failed, preserve the actual error; corrupt configuration and key failures do not trigger automatic repair. Sending another message or mentioning the plugin is not itself evidence that loading or connection succeeded.

## A native call or notification has an uncertain result

Read [results](../usage/results.md) or [interactions](../usage/interactions.md). Query current state; do not resend work. A callback delivery error does not establish native task failure. A failed release lookup does not establish an outdated or failed installation.

## A client cannot refresh its MCP catalog

Use its own connection/update guide. A working Server does not prove an existing conversation has fresh tool definitions. Compare the actual visible schema and a read-only call after the client's normal refresh. Client-specific recovery belongs in that guide.

Finish with [checks and handoff](../common/handoff.md).
