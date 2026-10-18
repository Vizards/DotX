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
- **Server:** Download its separate attachment and follow its deployment README with official Wrangler. Reuse the actual deployment configuration, account, Worker, origin, secrets and KV/DO resources; change the code path and target-required settings. Preserve the release discovery channel (`stable` by default, `dev` only by user choice).

Do not erase persistent state as an implicit upgrade step. Fresh installation is a separate user decision.

## 4. Activate the installed version

One Desktop MCP process owns the connector lock; others wait. A new version does not preempt the owner. Inspect running tasks and DotX processes, then retire identified obsolete owners and waiters, restart ChatGPT/Codex at a suitable time, or ask for assistance. Do not delete `connector.lock`; process exit releases it.

A brief DotX disconnect during connector replacement or Server deployment is expected and allowed as part of the update, unless the user requires uninterrupted availability. It does not itself stop native Codex work. Preserve configuration, identity and service association. Assess any broader desktop restart separately around active work. Arrange the local activation to finish without requiring another remote command during the disconnect.

When the Remote catalog changed, tell the coordinator to Refresh it in ChatGPT's normal plugin settings, or handle that step when coordinating directly with appropriate UI access. Server deployment alone does not refresh cached tools and instructions.

## 5. Verify and report, or resume

Verify the active Desktop version, Server version when assigned, protocol, interfaces and preserved configuration/identity. Cloudflare propagation can take seconds to minutes, including a new Worker briefly calling an older DO; allow convergence and repeat read-only checks before redeploying. After reconnection, runtime IDs and native interaction handles must be rediscovered.

Report what was installed, what is actually running, any outstanding catalog Refresh and remaining work. After interruption, inspect deployment, disk and running state and continue only unfinished operations; do not resend an uncertain business request. Verification does not run project tests or dispatch synthetic tasks.

For problems, start with the [online troubleshooting guide](https://github.com/Vizards/DotX/blob/main/docs/troubleshooting/index.md).
