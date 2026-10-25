# Remove, reset or change service

Distinguish removing access in the Server from uninstalling the local plugin. Read [access](../common/access.md).

Revoking a Codex device stops its current access without deleting its local identity. To reconnect that same installation later, follow [Codex connection](../codex/connect.md) and obtain fresh approval; resetting its keys is not required solely because it was revoked. Use the reset steps below when intentionally replacing identity or changing service.

For a Personal Agent, revoke its connection in /admin/agents (or the management CLI), then remove its local MCP configuration through that client's normal settings if requested. Revocation stops its grants and event deliveries; native Codex tasks already started continue.

For a Codex plugin:

1. Read device_status and record the exact host-provided DotX data_dir, device ID and target Server before uninstalling.
2. Revoke that device on the old Server when authorized and reachable. This is best effort, not a prerequisite for local reset or changing service. Report if it could not be done.
3. Uninstall through Codex's normal plugin mechanism. Refresh MCP configuration in every related host still loading it. Verify those instances exit and the connection stops; uninstalling files alone does not prove already loaded processes stopped. Give the user concrete refresh actions when unable to do them.
4. For an explicitly requested reset/service change, after confirming old instances exited, remove only the verified DotX plugin data directory. Preserve native Codex accounts, projects, conversations and tasks. A connection failure alone is not a request to reset.
5. Reinstall normally and follow [Codex connection](../codex/connect.md) for the target service. This creates a new identity and a new approval request. Do not add a hot-switch or runtime reset mechanism.

Report cloud revocation, local cleanup and any new application separately. Finish with [handoff](../common/handoff.md).
