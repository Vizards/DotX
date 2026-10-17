---
name: update
description: Plan and perform a user-requested DotX update from GitHub Releases, covering each Mac's Desktop, self-hosted Server and ChatGPT's cached Remote catalog. Use after the user chooses to update, not for routine task dispatch.
---

# Update DotX

Use the **target Release's** `update-SKILL.md`, `release.json` and release notes, rather than relying on an older installed skill. Published stable Releases are the default; use a Pre-release only when the user chooses it. Drafts and automatically generated source archives are not installation targets.

When troubleshooting, read the [online troubleshooting guide](https://github.com/Vizards/DotX/blob/main/docs/troubleshooting/index.md) and follow relevant links.

## Determine the work

`list_connections` provides a version-only update hint. Read the actual `server_version` and each Mac's `connector_version`; `desktop_version` refers to the native Codex application. An offline or unavailable connector does not establish its installed version: inspect locally when necessary. Downloaded files do not prove a new process has loaded.

`updates.channel` reports the deployment's discovery channel: `stable` by default, or `dev` when its owner explicitly chose development updates. Preserve that choice during deployment. A dev-channel hint points to a Pre-release; it does not authorize installation by itself. Discovery is cached for six hours, so a just-published version may not appear immediately.

Release metadata has `release`, `base_release`, `wire_protocol` and three reviewed booleans in `changes`: `server`, `desktop`, `remote_catalog`. Each stable release compares against its previous stable release. The first has a null baseline and all three true. Missing history is unknown, not false.

For each component's own running baseline, read every intervening stable Release's metadata through the target and OR the relevant flag. A Desktop already at an unchanged intermediate release can stay there even when Server advances. Aggregate `remote_catalog` over Server changes and check whether ChatGPT has already refreshed its definitions. Never decide from just the newest release's flags.

Pre-release metadata compares with its named stable `base_release`; it is not another link in stable history. When moving to or from a Pre-release and the stable chain cannot establish the installed contents, inspect the release notes and plan a complete replacement of the affected component and a catalog Refresh. Do not treat a numerically lower chosen version as an automatic update.

Compare `wire_protocol` separately. Different product versions do not by themselves require an update or prevent communication. A protocol change may require coordinating both ends. Explain the required components, catalog Refresh and interruptions before acting within the user's authorization.

## Apply and resume

- Download the target Desktop attachment to a persistent directory, then update through the same local marketplace identity (`dotx` / `dotx-desktop`). Use the actual installed desktop's plugin management capabilities. Preserve state, caller, credentials and service association outside the package.
- Download the independent Server attachment. Follow its deployment instructions and use official Wrangler with the existing account, Worker, origin and KV/DO resources. Change the code path and required configuration; do not replace the user's deployment configuration wholesale or create another service.
- After a catalog change, Refresh DotX Remote through ChatGPT's normal management interface and check the definitions in a fresh context. A Worker update changes execution code but does not prove that ChatGPT's cache refreshed. If prior cache state is unknown, inspect it or perform a normal Refresh. No separate Remote ZIP is installed.

Before a breaking protocol change, prepare the needed local installation access and attachments on each Mac. Do not rely exclusively on forwarding through a connector that the Server update will disconnect. Choose the order from the target release notes, running work and available local access. Handle offline Macs when they return. Do not erase DO state or credentials as an implicit upgrade step; fresh installation is a separate, explicitly scoped action.

After interruption, inspect deployment, disk and running state to continue remaining operations. No setup ledger or replay of business requests is needed. Arrange normal desktop reload/restart only when necessary and appropriate for running tasks.

Read back Server and connector versions, protocol compatibility, interface availability and any refreshed catalog. Report completed and still pending parts. Installation/update verification does not dispatch synthetic tasks or run the project's test suite.
