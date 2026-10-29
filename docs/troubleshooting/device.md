# Resolve an unavailable Codex

Use when discovery or setup reports an unusable device. Read `device_status` on the affected Mac, `list_connections` from a connected PA, or management `devices` as available; do not require all three. Complete: the required interface is usable, or the precise remaining action is handed off.

## Choose by current evidence

| Observed state | Action |
| --- | --- |
| No device installed | [Connect Codex](../codex/connect.md), then return to the original discovery check |
| Local tool missing | [Recover plugin loading](plugin-loading.md) |
| `SETUP_REQUIRED`, `DEVICE_SETUP_IN_PROGRESS`, `DEVICE_SETUP_INCOMPLETE` | Finish/resume `connect` with the same data directory and Server, then check automatic startup |
| Application pending | [Approve the device](../codex/approve.md), then check again |
| Device offline | Inspect the target Mac's Codex host/plugin and current diagnostic; cloud approval alone cannot make it run |
| `DEVICE_PROTOCOL_MISMATCH` | [Coordinate updates](../maintenance/update.md). The owner retains its lock and retries with backoff; do not re-enroll |
| Required native interface unavailable (including **Online · no interface**) | Inspect `device_status` on the affected Mac and preserve the native error before following the relevant recovery below. The browser's **Fix** action provides a prompt to send to that Mac's Codex |
| Missing/corrupt existing private key or configuration | Report the error; use [explicit reset/replacement](../maintenance/remove.md) only when authorized |

## Interpret owner and setup state

`entry` is the process answering the query; `owner` is the connector serving this installation. Assess `owner.connection` and `owner.interfaces`. A standby or old entry can report an online owner despite its own earlier diagnostic. Top-level target/device fields prefer that owner. Do not reset a healthy installation based on the entry's old setup error.

For older releases without owner fields, corroborate through the package's `cli.mjs status --state EXACT_DATA_DIR` and authorized management `devices`. Use host-provided paths. A missing owner requires diagnosis, not a guessed data directory.

First configuration is read after the setup command releases its lock and caller setup completes. The existing check runs every second; that is not a connection deadline. Incomplete setup keeps waiting; malformed data/startup errors require recovery. File edits do not hot-switch an already configured owner; use the update/reset guide for intentional changes.

If setup stopped before saving the native caller ID, rerun the same connect command. It can leave one unused empty caller while retaining device identity; a saved ID is reused. Do not reset the plugin or search other conversations to recover an empty caller.

## Reapply with the existing identity

Pending applications expire after seven days. When the user requests reconnection after expiry, rejection or revocation, run the same `connect` command. It keeps the keys/device ID and creates a fresh application requiring approval. If the configured owner stopped after rejection/revocation, refresh its host MCP configuration and verify the new request. There is no automatic reapplication. Reset only for intentional lost/compromised identity replacement or a Server change.

## Missing desktop transport

For `DESKTOP_PIPE_MISSING`, verify this plugin is loaded by the Desktop host and the package includes its `.codex-plugin/plugin.json` environment overlay. If incomplete, reinstall the complete package normally, refresh that host and recheck. A standalone CLI host may lack this context. Do not copy another process's pipe path or alter signature checks.

Once usable, return to the requesting connection/use task and repeat its read-only check. If unresolved, report the actual version, target, owner state and error without credentials or conversation content.
