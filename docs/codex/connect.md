# Connect this Mac's Codex

Run in local Codex on the Mac being added. Need: the target Server URL and selected Desktop release; ask for missing inputs. Server deployment or upgrade is a separate user request. Complete: the actual owner is connected to that Server, approved, and exposes the required native interfaces.

## Connect

1. Install the release's Desktop package through Codex's normal plugin mechanism. Its extracted ZIP contains `.agents/plugins/marketplace.json`. With the official CLI, register it using `codex plugin marketplace add /ABSOLUTE/EXTRACTED_DESKTOP`, then install `dotx-desktop` from `dotx` through the normal host mechanism. Reuse an existing matching installation.
2. Try `device_status` in the installing conversation; the Agent is responsible for verifying the installation. If unavailable, use [plugin loading recovery](../troubleshooting/plugin-loading.md): keep trying normal loading, offer the user a convenient restart in parallel, and arrange a local continuation if needed. Return here when the tool works. Use its exact `data_dir`; resolve the package root as the parent of `docs_dir`. Do not infer paths or borrow another plugin's data.
3. Run the installed package's command with a recognizable actual device name:

   ```sh
   node /ABSOLUTE/PLUGIN_ROOT/cli.mjs connect --state /EXACT/HOST_PLUGIN_DATA --url HTTPS_ORIGIN --name 'This Mac'
   ```

   Use Node satisfying the release requirement. This prepares the Ed25519 identity, native caller and public-key application. If configured for another Server, use the explicitly requested [service-change flow](../maintenance/remove.md).
4. The loaded plugin picks up complete first configuration automatically. Call `device_status` again and allow initialization; do not request a routine app restart. For an error, use [the reported device state](../troubleshooting/device.md).
5. If pending, complete [device approval](approve.md), then return here. When the user must approve, show `device_name`, `application.verification_label` and the exact `application.approval_url` from the command result together; ask them to match the name and short label before approving. An already approved device needs no new approval.

## Verify and continue

Check `target_server`, `device_id`, actual `owner.version`, `owner.connection.authenticated`, `owner.connection.approved`, wire compatibility and required `owner.interfaces`. A standby entry is healthy when it reports the actual healthy owner. Configuration written or an application submitted is not an available execution device.

This local check needs no Personal Agent. If remote MCP is already connected, also inspect `list_connections`; otherwise leave that check to PA connection. If approval/loading is still pending, say exactly what remains.

[Continue or hand off](../common/handoff.md): if no Personal Agent is connected, offer to help connect one and ask which client the user wants, unless already chosen. Continue with that client or return to the Agent waiting for this Mac. Preserve native Codex accounts, conversations, application files and normal plugin loading.

For later display-name changes, use `device-rename` in [management commands](../common/commands.md) or `/admin/devices`. Re-running `connect --name` does not rename an existing installation.

## Windows

The same flow works on a Windows PC with the Codex desktop app, with these platform differences:

1. The plugin package must use the PowerShell launcher variant: replace the plugin's `mcp.json` with `mcp.windows.json` (shipped in the plugin directory) so the host starts the connector through `launch.ps1`. Node discovery uses the desktop app's bundled `cua_node` runtime (packaged install under `WindowsApps`, or the per-user runtime under `%LOCALAPPDATA%\OpenAI\Codex`).
2. `device_status` must be called from a conversation in the desktop app, as on macOS; a CLI-only session does not load the plugin's tools.
3. The `client_coordination` interface is currently unavailable on Windows: the desktop app does not create `~/.codex/ipc/ipc.sock` there, so follows and remote approval relay do not work yet. `app_tools` and `app_server` are fully usable; a task that needs approval waits for the user in the desktop app itself.

Verified end to end on Windows 11 24H2 with Codex 26.1027.3384.0 on 2026-10-31: the device enrolled and was approved, the owner came online, and a Personal Agent completed a read-only task through `app_tools`.
