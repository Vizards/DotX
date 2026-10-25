# Verify the stage and continue

Report what is actually verified. Complete available authorized work before handing it off. Do not start synthetic Codex tasks as part of ordinary user installation or updates.

## Check the stage you completed

| Stage | Evidence required | Next action |
| --- | --- | --- |
| Server | `/health` and `/setup/info` identify the intended origin, version, wire and service; management access and web page loading work | If neither Codex nor Personal Agent exists, [connect Codex](../codex/connect.md) first |
| Local Codex | After host MCP refresh, `device_status` shows the intended Server/device, actual owner version, authenticated and approved connection, and required native interface availability | [Connect the chosen Personal Agent](../index.md), or check an existing remote connection |
| Personal Agent | Its OAuth connection can make an authenticated `list_connections` request, and the result contains a usable Codex with the required interface | Continue the user's intended work; if none is usable, resolve the specific missing prerequisite below |
| Update | Each changed component reports the target running version; separately check the authenticated, compatible link and required native interface | Refresh affected clients' catalogs, then resume the user's task after reconciling any uncertain work |

Local Codex verification does not require `list_connections` when no Personal Agent is connected yet. The local plugin exposes `device_status`; an authorized maintenance Agent can also corroborate the device through `admin.mjs devices`. If remote MCP is already available, add its `list_connections` result. Record end-to-end acceptance as pending until the Personal Agent can use that link; do not create a connection solely to obtain a local installation check.

A submitted Codex application can be handed off as **awaiting approval**, with its identity and target verified. It is not ready to execute. After approval, repeat the local checks above. An entry marked standby is healthy when it can read the approved actual owner's status.

When a Personal Agent has no usable Codex, identify the reason before choosing the next action:

- No device installed: continue [Codex connection](../codex/connect.md) on the intended Mac.
- Approval pending: perform the [management access check](access.md) if capable, then approve the matching application or hand it to the administrator.
- Offline, incompatible or missing native interface: follow [troubleshooting](../troubleshooting/index.md). OAuth success alone does not resolve these states.

## Hand off only the remaining work

Give the user a concise message to pass on, or send it to another Agent when the user has authorized that communication. Use this information as needed:

```text
Goal: what the user wants to achieve
Target: Server URL, component versions, relevant device/Agent connection IDs
Completed: actions and the status fields that verify them
Next: one concrete action, who can perform it, and the relevant versioned guide/page
Blocked by: actual error or missing capability; checks not yet completed
```

Do not include access codes, OAuth credentials, private keys or conversation bodies in general handoffs or diagnostic records. Supply an access code only to the intended enrollment flow, with its actual deadline and [authorization guide](../personal-agents/authorization.md).

Link the next concrete guide and identify the action; a link to the project README alone is not a handoff. Report component readiness, pending approval and end-to-end usability separately.
