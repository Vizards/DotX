---
name: update
description: Coordinate a user-requested DotX update from ChatGPT or dot through DotX Remote. Resolve the plan and permissions before delegating installation to local Codex.
---

# Coordinate a DotX update

You coordinate the update; local Codex executes installation and deployment with its Desktop update skill. Read this workflow before creating an execution conversation or dispatching update work.

## 1. Establish the update plan

Use `list_connections` to identify the service and each Mac's running `connector_version`, availability and protocol. `desktop_version` identifies Codex itself. The latest-release hint provides a Release page URL; use the user's chosen version when specified. Default to published stable Releases, with Pre-releases only by user choice.

Read `release.json` and the Release notes. For each component's own baseline, read intervening stable Releases and OR their `changes.server`, `changes.desktop` and `changes.remote_catalog` flags. Release notes carry version-specific requirements, including configuration changes and ordering. A Pre-release compares with its declared stable `base_release`, not the previous dev build; when this cannot establish installed contents, use the notes and observed state to plan replacement and catalog Refresh. Missing history is unknown. If required release information cannot be read, retry or use another available reading method; report an unresolved blocker before dispatching the affected work.

Check `wire_protocol` separately from product versions. Identify the components, execution Macs, order and expected interruptions. Before a protocol-breaking update, arrange local access and download the required artifacts so recovery does not depend on the connection being replaced.

## 2. Resolve execution permissions before dispatch

Reuse applicable user choices and inspect an existing conversation's permissions. For a new conversation without an applicable permission choice, ask the user before creating it. Explain that limited permissions may require command approvals; an update request alone does not select Full Access. Bring unresolved choices to the user rather than answering on their behalf.

Read the `conversations` and `settings` guides through `get_instructions` to resolve model/reasoning choices and configure permissions. App Tools starts work immediately: create with an initialization-only prompt, wait for it to finish, apply and verify the chosen settings, then send actual update work. Verify the execution turn's `currentPermissions`; saved settings alone do not prove that turn's permissions.

## 3. Delegate the agreed work

Give each local executor the target Release, assigned components, agreed permissions and relevant version-specific requirements as a direct request. It reads the installed Desktop update skill for local mechanics. Keep user decisions with the coordinator; reuse settled choices instead of asking again. Read the `results` and `interactions` guides to track exact turns and handle approvals or questions.

## 4. Allow activation and refresh the catalog

Replacing DotX connector processes or deploying Server may briefly disconnect DotX and then reconnect; allow this as part of the update unless the user requires uninterrupted availability. Preserve configuration, identity and service association. A connector disconnect does not itself stop the native Codex task. Let the local executor choose activation around running tasks and assess any broader desktop restart separately.

When `remote_catalog` changed, Refresh DotX Remote in ChatGPT's normal plugin settings and verify the definitions in the client that will use it. Deployment alone does not refresh that cache. If an existing dot still sees old definitions, consider restarting it when ongoing work can be interrupted; see [stale tool definitions](https://github.com/Vizards/DotX/blob/main/docs/troubleshooting/index.md#dot-still-sees-old-tool-definitions-after-an-update).

## 5. Verify or resume

After reconnection, rediscover runtime IDs and current native interactions, then reconcile the original request and turn before sending more work. Read back actual Server/Desktop versions, protocol and each native interface; combine these with local reports of preserved configuration and identity. Report installed-but-not-active components as unfinished. A correct version and overall online status are insufficient while a native interface remains unavailable or reports errors.

A Durable Object may load new code after Worker deployment finishes. If versions or connectivity disagree during the switch, allow time for the DO update and recheck current status before deciding whether further action is needed. Release discovery caching and ChatGPT's catalog cache are separate. After interruption, continue only unfinished operations. Verification does not run project tests or dispatch synthetic tasks.

For problems, start with the [online troubleshooting guide](https://github.com/Vizards/DotX/blob/main/docs/troubleshooting/index.md).
