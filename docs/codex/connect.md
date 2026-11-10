# Connect this computer's Codex

Run in local Codex on the computer being added. Need: the target Server URL and selected Desktop release; ask for missing inputs. Server deployment or upgrade is a separate user request. Complete: the actual owner is connected to that Server, approved, and exposes the required native interfaces.

## Connect

1. Install the release's Desktop package through Codex's normal plugin mechanism. Its extracted ZIP contains `.agents/plugins/marketplace.json`. With the desktop host's official CLI, register it using `codex plugin marketplace add "ABSOLUTE_EXTRACTED_DESKTOP_PATH"`, substituting the actual executable and directory, then install `dotx-desktop` from `dotx` through the normal host mechanism. Reuse an existing matching installation. See [host requirements](runtime.md#check-the-host) for platform context.
2. Try `device_status` in the installing conversation; the Agent is responsible for verifying the installation. If unavailable, use [plugin loading recovery](../troubleshooting/plugin-loading.md): keep trying normal loading, offer the user a convenient restart in parallel, and arrange a local continuation if needed. Return here when the tool works. Use its exact `data_dir`; resolve the package root as the parent of `docs_dir`. Do not infer paths or borrow another plugin's data.
3. Use the installed package's [local command reference](runtime.md#run-the-requested-command) to run `connect` with the exact data directory, Server URL and a recognizable actual device name, then return here. Its platform launcher uses the desktop runtime. This prepares the Ed25519 identity, native caller and public-key application. If configured for another Server, use the explicitly requested [service-change flow](../maintenance/remove.md).
4. The loaded plugin picks up complete first configuration automatically. Call `device_status` again and allow initialization; do not request a routine app restart. For an error, use [the reported device state](../troubleshooting/device.md).
5. If pending, complete [device approval](approve.md), then return here. When the user must approve, show `device_name`, `application.verification_label` and the exact `application.approval_url` from the command result together; ask them to match the name and short label before approving. An already approved device needs no new approval.

## Verify and continue

Check `target_server`, `device_id`, actual `owner.version`, `owner.connection.authenticated`, `owner.connection.approved`, wire compatibility and required `owner.interfaces`. A standby entry is healthy when it reports the actual healthy owner. Configuration written or an application submitted is not an available execution device.

This local check needs no Personal Agent. If remote MCP is already connected, also inspect `list_connections`; otherwise leave that check to PA connection. If approval/loading is still pending, say exactly what remains.

[Continue or hand off](../common/handoff.md): if no Personal Agent is connected, offer to help connect one and ask which client the user wants, unless already chosen. Continue with that client or return to the Agent waiting for this device. Preserve native Codex accounts, conversations, application files and normal plugin loading.

For later display-name changes, use `device-rename` in [management commands](../common/commands.md) or `/admin/devices`. Re-running `connect --name` does not rename an existing installation.
