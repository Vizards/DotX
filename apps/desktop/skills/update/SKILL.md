---
name: update
description: Execute a user-requested DotX update with local Mac access, including Desktop activation and Server deployment. Reuse an agreed remote plan or establish the scope and permissions when asked directly.
---

# Update DotX locally

When ChatGPT or dot delegates an update, execute its agreed scope and permission choices and report unresolved decisions back. When the user asks you directly, establish those choices yourself before installation. This skill is available locally even while DotX is disconnected.

## 1. Establish the target and current state

Read the target Release's `release.json` and Release notes, which carry version-specific configuration, ordering and migration requirements. Default to published stable Releases unless the user chooses a Pre-release. Drafts and source archives are not installation packages.

For a delegated update, check the assigned plan against local state. For a direct request, determine changes from each component's installed baseline: OR the intervening stable Releases' `server`, `desktop` and `remote_catalog` flags and read their notes. Pre-releases compare with their declared stable `base_release`, not the previous dev build; use release notes and actual state where that comparison cannot establish installed contents. Missing history is unknown. Resolve unreadable required release information before the affected operation.

Inspect installed files and running processes; use local `device_status` or Remote `list_connections` when available. `connector_version` is DotX; `desktop_version` is Codex. Check `wire_protocol` separately. Prepare artifacts and local access before replacing an incompatible connection.

## 2. Check the executing conversation's permissions

Reuse the agreed user choice without asking again. Check the permissions of the conversation actually executing the commands; saved settings alone do not establish an active turn's permissions. If a choice is missing or execution needs broader access, ask the user or remote coordinator before changing it. An update request alone does not select Full Access. Approve for me preserves the sandbox and may still decline a command or require human input.

## 3. Install the assigned components

- **Desktop:** Download its attachment to a persistent directory and update through the same local marketplace identity, `dotx` / `dotx-desktop`, using the installed Codex's plugin management. Preserve installation state, caller, credentials and service association outside the package.
- **Server:** Download its separate attachment and follow its deployment README with official Wrangler. Reuse the actual deployment configuration, account, Worker, origin, secrets and KV/DO resources; point both `main` and `assets.directory` at the Worker and `public` directory from the same target attachment. Preserve the release discovery channel (`stable` by default, `dev` only by user choice).

Do not erase persistent state as an implicit upgrade step. Fresh installation is a separate user decision.

## 4. Activate the installed version

One Desktop MCP process owns the connector lock; others wait. A new version does not preempt the owner. Before retiring identified obsolete owners and waiters, confirm the target package is installed and choose how Codex will load it through its normal plugin lifecycle, taking running tasks into account. Reload through the host, arrange a ChatGPT/Codex restart at a suitable time, or ask for assistance. Do not delete `connector.lock`; process exit releases it. Do not build a separate host or leave a manually managed connector running as the installed solution.

A brief DotX disconnect during connector replacement or Server deployment is expected and allowed as part of the update, unless the user requires uninterrupted availability. It does not itself stop native Codex work. Preserve configuration, identity and service association. Assess any broader desktop restart separately around active work. Prepare the local operations needed during the disconnect. If normal activation cannot be completed, preserve the current installation and configuration and report the component as installed but awaiting activation, with the remaining action or blocker.

When the Remote catalog changed, tell the coordinator to Refresh it in ChatGPT's normal plugin settings, or handle that step when coordinating directly with appropriate UI access. Server deployment alone does not refresh cached tools and instructions.

## 5. Verify and report, or resume

Verify the active Desktop version, Server version when assigned, protocol, each native interface and preserved configuration/identity. The expected version and overall online status do not establish that every interface works; investigate reported interface failures or report the update as unfinished. If temporary diagnostic processes were used, confirm they have exited and the active connector is loaded by Codex normally. A Durable Object may load new code after Worker deployment finishes. If versions or connectivity disagree during the switch, allow time for the DO update and recheck current status before deciding whether further action is needed. After reconnection, runtime IDs and native interaction handles must be rediscovered.

Report what was installed, what is actually running, any outstanding catalog Refresh and remaining work. After interruption, inspect deployment, disk and running state and continue only unfinished operations; do not resend an uncertain business request. Verification does not run project tests or dispatch synthetic tasks.

For problems, start with the [online troubleshooting guide](https://github.com/Vizards/DotX/blob/main/docs/troubleshooting/index.md).
