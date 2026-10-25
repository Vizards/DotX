# DotX agent guide

Start from the user's goal. Inspect what is already complete, do the authorized work available in your environment, and verify the result. Do not require a particular Agent, browser or workstation.

## Find the relevant guide

- With DotX Remote MCP available, call `get_instructions` with the goal below to receive the full guide. Without a goal it returns this index and the available guides.
- In the Desktop plugin, read the bundled files through the relative links below. Use `device_status.docs_dir` to locate that installation's guides.
- From GitHub or a release attachment, read the selected version's `docs/index.md` and follow its links. Use the installed version for current behavior and the target version for an update; do not substitute `main` or the latest guide for an older version.

| User goal | MCP goal | Guide |
| --- | --- | --- |
| Install a Server | `server_install` | [Server installation](server/install.md) |
| Connect this Mac's Codex | `codex_connect` | [Codex connection](codex/connect.md) |
| Connect or configure dot | `dot` | [dot](personal-agents/dot/index.md) |
| Connect or configure Cue | `cue` | [Cue](personal-agents/cue/index.md) |
| Recover OAuth or understand expiry | `authorization` | [Personal Agent authorization](personal-agents/authorization.md) |
| Discover devices and native interfaces | `connections` | [Connections](usage/connections.md) |
| Start or continue work | `conversations` | [Conversations](usage/conversations.md) |
| Set permissions or Fast | `settings` | [Settings](usage/settings.md) |
| Confirm results or reconcile an uncertain outcome | `results` | [Results](usage/results.md) |
| Receive events and answer questions | `interactions` | [Interactions](usage/interactions.md) |
| Choose and coordinate an update | `update` | [Update coordination](maintenance/update.md) |
| Update Server | `server_update` | [Server update](server/update.md) |
| Update local Codex | `codex_update` | [Codex update](codex/update.md) |
| Uninstall, reset or change Server | `remove` | [Removal](maintenance/remove.md) |
| Diagnose a failure | `troubleshooting` | [Troubleshooting](troubleshooting/index.md) |
| Check management authority | `access` | [Access](common/access.md) |
| Verify a stage and continue on another Agent | `handoff` | [Checks and handoff](common/handoff.md) |

Read only the relevant pages. Deployment, approval, revocation and other management actions require the [access check](common/access.md). Ordinary MCP use follows the existing Personal Agent authorization and does not require Wrangler or a Cloudflare login.

## Continue from the current stage

Server installation, local Codex connection and Personal Agent connection are independent tasks. A new complete network normally proceeds Server → first Codex → Personal Agent. If the user enters elsewhere, inspect the missing prerequisite and continue that guide. Reuse completed installation, configuration and approval steps.

Finish each stage with [checks and handoff](common/handoff.md). Complete available authorized work; when a capability is missing, give the user or next authorized Agent the exact remaining action. No separate Get Started workflow is required.

This directory is the sole maintained guide source. Desktop bundles these files; Server returns them through `get_instructions`. Server and Desktop may run different product versions; wire compatibility determines whether they can communicate.
