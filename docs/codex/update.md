# Update the local Codex plugin

Read [update coordination](../maintenance/update.md). Run on the affected Mac and use the target Desktop release plus its notes.

1. Read device_status; save the actual owner version, device ID, target Server and host-provided data_dir. Keep the data directory, private key and connector generation. An update is not a reset or new enrollment.
2. Update/install the plugin through the normal Codex mechanism, then refresh MCP configuration in every related host still loading the old plugin. The OS lock chooses one owner; a newly loaded package does not preempt a healthy older owner based on version. Do not delete a lock file or kill unrelated app processes to force ownership.
3. Call device_status again. Confirm the actual owner runs the target version, retains the same identity and passes its native interface checks. An old tool entry returning Transport closed only establishes that entry closed; rediscover the current entry and owner.
4. Report Desktop component completion separately from the Server link. If wire is incompatible, the owner retains its lock and reconnects with backoff. Coordinate the other component, then verify an authenticated compatible link and required native interface. Do not re-enroll to fix wire mismatch.

If a normal refresh fails, preserve diagnostics and follow [host loading recovery](../troubleshooting/index.md#the-installed-plugins-tool-is-missing). A failed new binary can be replaced with a known usable compatible release using the same normal installation path and retained identity; do not silently downgrade. Finish with [handoff](../common/handoff.md).
