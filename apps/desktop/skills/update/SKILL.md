---
name: update
description: Plan and perform a user-requested DotX update from GitHub Releases, covering each Mac's Desktop, self-hosted Server and ChatGPT's cached Remote catalog. Use after the user chooses to update, not for routine task dispatch.
---

# Update DotX

The conversation receiving the user's update request coordinates this workflow, whether it is ChatGPT, dot or local Codex. Read this skill before delegating. The coordinator resolves the scope, execution permissions and order with the user, then gives each local executor its agreed work and choices. A delegated executor applies that plan and reports unresolved choices back to the coordinator; reading this skill locally does not replace the coordinator's preparation.

## 1. Establish the target and current state

Read the target Release's `update-SKILL.md`, `release.json` and release notes. Use a published stable Release unless the user chooses a Pre-release; Drafts and source archives are not installation packages.

Use `list_connections` to record Server and each Mac's running `connector_version`, availability and protocol. `desktop_version` identifies Codex itself. Inspect an offline Mac locally if needed; downloaded files do not prove the running version.

## 2. Decide what changes

For each component's own baseline, read the intervening stable Release metadata and OR its `changes.server`, `changes.desktop` or `changes.remote_catalog` flags. Missing history is unknown. A Pre-release compares with its named stable `base_release`, not the previous dev build; when that cannot establish the installed contents, use the release notes to plan replacement and catalog Refresh.

Check `wire_protocol` separately from product versions. State which Macs, Server and Remote catalog need updating, in what order, and any interruption. Before a protocol-breaking update, prepare local access and attachments so recovery does not depend on the connection being replaced.

## 3. Settle execution permissions before dispatch

The coordinator identifies where each update will execute and settles permissions before dispatching installation or deployment work. For an existing conversation, inspect its permissions and reuse the applicable user choice without asking again. For a new conversation without an applicable choice, ask the user before creating it. Explain that limited permissions can require command approvals; an update request alone does not select Full Access. Pass the resolved choice to the executor. If an executor asks about an unresolved choice, bring it to the user rather than selecting on their behalf.

App Tools `create_thread` starts its first turn immediately and has no permission argument. After the user chooses permissions for a new task, create it with an initialization-only prompt and wait for that turn to finish. Apply the chosen settings through `client_coordination`, verify a fresh settings snapshot, then send the actual update work. Check the new execution turn's `currentPermissions`; saved settings do not change an already-running turn. Reconcile progress before continuing under changed permissions. Preserve model and reasoning settings unless asked to change them.

## 4. Install the selected components

- **Server:** Download its separate attachment and follow its deployment instructions with official Wrangler. Reuse the existing account, Worker, origin, secrets, KV/DO resources and actual deployment configuration; change the code path and required settings. Preserve the release discovery channel (`stable` by default, `dev` only by user choice).
- **Each Mac:** Download the Desktop attachment to a persistent directory and update through the same local marketplace identity, `dotx` / `dotx-desktop`, using the installed Codex's plugin management. Preserve installation state, caller, credentials and service association outside the package.

Do not erase persistent state as an implicit upgrade step. Fresh installation is a separate user decision.

## 5. Activate and refresh

One Desktop MCP process owns the connector lock; others wait. A new version does not preempt the owner. Based on running tasks, retire identified obsolete DotX processes, restart ChatGPT/Codex normally, or ask the user. Include old waiters and every pre-lock instance. Do not delete `connector.lock`; process exit releases it. Verify the active version after reload.

Refresh DotX Remote through ChatGPT's normal settings when its catalog changed; verify the definitions in the client that will use it. A Server deployment does not refresh ChatGPT's cached tools and instructions. If an existing dot still sees old definitions after Refresh, consider restarting it when ongoing work can be interrupted, then verify the new declarations and a read-only call. See [stale tool definitions](https://github.com/Vizards/DotX/blob/main/docs/troubleshooting/index.md#dot-still-sees-old-tool-definitions-after-an-update).

Cloudflare code propagation can take seconds to minutes, including a new Worker briefly calling an older DO. After successful deployment, allow convergence and repeat read-only checks before redeploying. This differs from GitHub discovery caching (six hours after success, five minutes after failure) and ChatGPT's catalog cache.

## 6. Verify or resume

Read back running Server/Desktop versions, protocol, interfaces, preserved configuration and any refreshed catalog. Report remaining work explicitly. After interruption, compare deployment, disk and running state, then continue only unfinished operations; do not resend an uncertain business request.

Installation and update checks do not run project tests or dispatch synthetic tasks. For problems, start with the [online troubleshooting guide](https://github.com/Vizards/DotX/blob/main/docs/troubleshooting/index.md).
