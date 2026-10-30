# Update the local Codex plugin

Read [update coordination](../maintenance/update.md). Run on the affected Mac and use the target Desktop release plus its notes.

1. Read device_status; save the actual owner version, device ID, target Server and host-provided data_dir. Keep the data directory, private key and connector generation. An update is not a reset or new enrollment.
2. Update the existing `dotx` marketplace's persistent source to the target Desktop package, then install `dotx-desktop` from that source.
3. Refresh MCP in the actual Codex desktop hosts loading the plugin. Reloading DotX's independent App Server does not refresh the desktop app.
4. Call device_status again. Confirm the actual owner runs the target version, retains the same identity and passes its native interface checks. An old tool entry returning Transport closed only establishes that entry closed; rediscover the current entry and owner.
5. Report Desktop component completion separately from the Server link. If wire is incompatible, the owner retains its lock and reconnects with backoff. Coordinate the other component, then verify an authenticated compatible link and required native interface. Do not re-enroll to fix wire mismatch.

If a normal refresh fails, preserve diagnostics and follow [host loading recovery](../troubleshooting/plugin-loading.md). A failed new binary can be replaced with a known usable compatible release using the same normal installation path and retained identity; do not silently downgrade. Finish with [handoff](../common/handoff.md).
