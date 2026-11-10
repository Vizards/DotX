# Resolve an unavailable Codex

Use when discovery or setup reports an unusable device. Read `device_status` on the affected computer, `list_connections` from a connected PA, or management `devices` as available; do not require all three. Complete: the required interface is usable, or the precise remaining action is handed off.

## Choose by current evidence

| Observed state | Action |
| --- | --- |
| No device installed | [Connect Codex](../codex/connect.md), then return to the original discovery check |
| Local tool missing | [Recover plugin loading](plugin-loading.md) |
| `SETUP_REQUIRED`, `DEVICE_SETUP_IN_PROGRESS`, `DEVICE_SETUP_INCOMPLETE` | Finish/resume `connect` with the same data directory and Server, then check automatic startup |
| Application pending | [Approve the device](../codex/approve.md), then check again |
| `ENROLLMENT_ATTEMPTS_EXHAUSTED` | Wait `retry_after_seconds`, then retry the same connection setup. The Server allows 10 new applications per 60 seconds; existing applications can still be read and approved |
| Device offline | Inspect the target computer's Codex host/plugin and current diagnostic; cloud approval alone cannot make it run |
| `DEVICE_PROTOCOL_MISMATCH` | [Coordinate updates](../maintenance/update.md). The owner retains its lock and retries with backoff; do not re-enroll |
| Required native interface unavailable (including **Online · no interface**) | Inspect `device_status` on the affected computer and preserve the native error before following the relevant recovery below. The browser's **Fix** action provides a prompt to send to that computer's Codex |
| Missing/corrupt existing private key or configuration | Report the error; use [explicit reset/replacement](../maintenance/remove.md) only when authorized |
| Windows runtime path missing, PowerShell failure or desktop version `unknown` | Follow [Windows runtime diagnosis](#windows-runtime-and-powershell); distinguish connection failure from missing version metadata |

## Interpret owner and setup state

`entry` is the process answering the query; `owner` is the connector serving this installation. Assess `owner.connection` and `owner.interfaces`. A standby or old entry can report an online owner despite its own earlier diagnostic. Top-level target/device fields prefer that owner. Do not reset a healthy installation based on the entry's old setup error.

When a separate local status read is needed, use the installed package's [command reference](../codex/runtime.md#run-the-requested-command) and corroborate through authorized management `devices` as available. Use host-provided paths and the installed release's instructions. A missing owner requires diagnosis, not a guessed data directory.

First configuration is read after the setup command releases its lock and caller setup completes. The existing check runs every second; that is not a connection deadline. Incomplete setup keeps waiting; malformed data/startup errors require recovery. File edits do not hot-switch an already configured owner; use the update/reset guide for intentional changes.

If setup stopped before saving the native caller ID, rerun the same connect command. It can leave one unused empty caller while retaining device identity; a saved ID is reused. Do not reset the plugin or search other conversations to recover an empty caller.

## Reapply with the existing identity

Pending applications expire after seven days. Expired unapproved applications and their matching device records are pruned on new enrollment or list reads; approved and revoked devices are retained. When the user requests reconnection after expiry, rejection or revocation, run the same `connect` command. It keeps the keys/device ID and creates a fresh application requiring approval. If the configured owner stopped after rejection/revocation, refresh its host MCP configuration and verify the new request. There is no automatic reapplication. Reset only for intentional lost/compromised identity replacement or a Server change.

## Missing desktop transport

For `DESKTOP_PIPE_MISSING`, verify this plugin is loaded by the Desktop host and the package includes its `.codex-plugin/plugin.json` environment overlay. If incomplete, reinstall the complete package normally, refresh that host and recheck. A standalone CLI host may lack this context. Do not copy another process's pipe path or alter signature checks.

## Windows runtime and PowerShell

Preserve the reported operation, native error and exit/timeout details. If the MCP entry cannot start, inspect the host's plugin-loading error; `device_status` may not be available yet.

| Error or observation | Action |
| --- | --- |
| `CODEX_MCP_NODE_PATH_REQUIRED` or `CODEX_APP_RUNTIME_CLI_PATH_REQUIRED` | Verify the normal Codex desktop host and complete plugin environment overlay. Run local commands in that host's native Windows shell. Use its supplied runtime paths; do not scan installation folders or substitute an unrelated Node/CLI. Return to [local commands](../codex/runtime.md) after context is restored |
| `WINDOWS_POWERSHELL_FAILED` while initializing the private data directory | Check the reported script/path, system Windows PowerShell availability and the device's script/application-control policy. Reinstall an incomplete package normally; hand an enforced policy restriction to the administrator. Permission initialization must succeed before normal connection setup; do not bypass it or recreate keys |
| `DESKTOP_VERSION_UNAVAILABLE`, with registered desktop version `unknown` | The version query failed; preserve its underlying error. This field describes the current user's registered Codex desktop package, not the DotX plugin or CLI version. Check the actual owner and required interfaces before deciding whether the connection is usable |

Version-query success or failure is cached for the process. After resolving that cause, a normal host refresh can obtain a new result. There is no need to reset the installation to refresh metadata. A PowerShell version-query failure is a metadata downgrade; a private-directory permission failure is not.

Once usable, return to the requesting connection/use task and repeat its read-only check. If unresolved, report the actual version, target, owner state and error without credentials or conversation content.
