# Load an installed Codex plugin

Use when DotX Desktop is installed but the actual local conversation cannot call `device_status`, or a normal update refresh did not expose the new entry. Complete: this host can call the tool; return to the installation/update step that requested it.

1. Verify the intended plugin is installed and enabled. Select it through the normal plugin picker when needed, then rediscover tools.
2. Use the actual host's normal loading/refresh capability if available. Native App Server methods include `plugin/install` and `config/mcpServer/reload`; discover their current schemas before use. A reload queues work and must reach this host, not an independent CLI App Server. Check for the tool again.
3. If still missing, continue in a new ordinary local Codex conversation on this Mac. Give [a short handoff](../common/handoff.md#hand-off-a-task) with Server, selected version, completed installation and the missing tool. Reuse the existing installation and any submitted application.
4. Only if normal loading and a new conversation fail, coordinate an app restart with the user. Defer it while other tasks run. Do not kill the app or modify binaries, signatures, startup behavior or other plugin processes.

A new conversation has worked in real Desktop installations, but verify this host rather than promising universal behavior. Mentioning a Skill or sending another message does not prove its MCP loaded.

If `device_status` is callable but reports setup/connection failure, use [device diagnosis](device.md) instead. `Transport closed` on an old entry after update means rediscover the current entry; it does not establish that the actual owner is offline.
