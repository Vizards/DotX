# Choose the observed problem

Start with the actual failure, not a full installation checklist. Use evidence available here: `device_status` locally, `list_connections` remotely, management results or `/health`. Do not require access to all of them. Keep credentials and conversation bodies out of diagnostics.

| Observed problem | Read next |
| --- | --- |
| Installed Codex plugin's tool is absent | [Load the installed plugin](plugin-loading.md) |
| Device pending, offline, incompatible or missing an interface | [Resolve an unavailable Codex](device.md) |
| Browser management cannot sign in | [Browser login/recovery](../server/browser-login.md) |
| Wrangler management request fails | [Find management access](../common/access.md#if-you-cannot-perform-it) |
| PA approval, OAuth callback or renewal fails | [OAuth recovery](../personal-agents/authorization.md#recover-an-interruption) |
| PA tools are absent or stale | [Find the client's refresh route](../personal-agents/index.md#refresh-tools) |
| dot has authorized but tools are absent/stale | [Refresh the current dot](../personal-agents/dot/index.md#tools-missing-or-catalog-changed) |
| Cue uses the wrong endpoint or cannot finish adding it | [Cue's observed-state branches](../personal-agents/cue/index.md#if-blocked) |
| Send/answer timed out or result is uncertain | [Reconcile the operation](../usage/results.md#recover-without-duplicating-work) |
| Notification missing or subscription failed | [Recover observation](../usage/interactions.md#recover-missing-notifications-or-a-failed-subscription) |
| Update hint unavailable, including `GITHUB_HTTP_403` | [Release discovery](../maintenance/update.md#release-discovery); ordinary use can continue |

Complete that branch, then return to the original task and repeat its relevant check. If no branch fits, report the versions, target, last verified result and native/platform error. Do not infer task failure from notification failure, or reset/reinstall solely because an upstream request failed.
