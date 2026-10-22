# Install and verify the local Desktop plugin

Use a published GitHub Release's **Desktop attachment**, not its source archive. Download and extract it to a persistent directory, then register its local marketplace and install `dotx-desktop` using the installed desktop's native plugin management capabilities. The marketplace identity is `dotx`. Do not upload Desktop over a Remote plugin record.

The setup and join `SKILL.md` files are two levels below the installed plugin directory `<plugin>`, which contains `setup.mjs`. Commands require Node 24.12+; the desktop's signed runtime is at `Contents/Resources/cua_node/bin/node` inside its application. `DOTX_APP_PATH` selects a nonstandard application location. The launcher uses normal desktop loading; its `.mcp.json` working directory is resolved by the desktop loader, whereas argument placeholders are not.

The installed plugin includes `release.json` with its source repository and product version. Do not invent a repository address for an unpublished development package.

Inspect `node <plugin>/setup.mjs status` before configuring the Mac and after an interruption. Local state defaults to `~/.local/state/dotx`, overridden by `DOTX_STATE_DIR`. Local association or configuration does not prove the connector is online. `init-local` reuses the device identity and archived caller without a model turn; no caller opening or wake message is needed. `enroll` reuses the device and pairing request.

After enrollment, read local `device_status` and, when available, Remote `list_connections` to confirm that the loaded connector matches the selected release, this Mac is associated with the intended service, and the device and its `app_tools`, `app_server` and `client_coordination` interfaces are online. Their online status reflects the connector's built-in readiness checks. When these checks pass, report installation and basic connectivity as verified; do not claim untested task dispatch, approvals or receipts have passed functional testing.

Investigate reported connection or interface failures as needed. Distinguish a target conversation without a current desktop owner from an unavailable interface; a failed query for that conversation alone does not establish installation failure. An additional native call for every interface is not required. Installation does not run project tests or send synthetic tasks.

If activation requires Codex's reload or restart controls, ask the user to operate them at a suitable time around running tasks. Computer use cannot control Codex itself; do not attempt to use it for these steps. If reloading leaves an obsolete connector active, ask the user to fully quit (Quit / Cmd+Q) and reopen the Codex/ChatGPT Desktop app hosting the plugin, then recheck the loaded version and connectivity.
