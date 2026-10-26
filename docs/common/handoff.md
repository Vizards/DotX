# Verify the stage and continue

Report what is actually verified. Complete available authorized work before handing it off. Do not start synthetic Codex tasks as part of ordinary user installation or updates.

## Check the stage you completed

| Stage | Evidence required | Next action |
| --- | --- | --- |
| Server | `/health` and `/setup/info` identify the intended origin, version, wire and service; management access and web page loading work | If neither Codex nor Personal Agent exists, [connect Codex](../codex/connect.md) first |
| Local Codex | Once the plugin has loaded and picked up its first configuration, `device_status` shows the intended Server/device, actual owner version, authenticated and approved connection, and required native interface availability | [Connect the chosen Personal Agent](../index.md), or check an existing remote connection |
| Personal Agent | Its OAuth connection can make an authenticated `list_connections` request, and the result contains a usable Codex with the required interface | Continue the user's intended work; if none is usable, resolve the specific missing prerequisite below |
| Update | Each changed component reports the target running version; separately check the authenticated, compatible link and required native interface | Refresh affected clients' catalogs, then resume the user's task after reconciling any uncertain work |

Local Codex verification does not require `list_connections` when no Personal Agent is connected yet. The local plugin exposes `device_status`; an authorized maintenance Agent can also corroborate the device through `admin.mjs devices`. If remote MCP is already available, add its `list_connections` result. Record end-to-end acceptance as pending until the Personal Agent can use that link; do not create a connection solely to obtain a local installation check.

A submitted Codex application can be handed off as **awaiting approval**, with its identity and target verified. It is not ready to execute. After approval, repeat the local checks above. An entry marked standby is healthy when it can read the approved actual owner's status.

`entry` describes the queried plugin process; `owner` describes the connector actually serving this installation. An older entry can retain an unconfigured/unavailable role and its `entry.diagnostic` while reporting a healthy current owner. Assess connectivity from `owner.connection` and `owner.interfaces`; the top-level target and device fields prefer that owner's identity. A missing owner still requires the relevant setup/refresh/recovery action. Do not reset an online device because a leftover entry has an old setup diagnostic.

When a Personal Agent has no usable Codex, identify the reason before choosing the next action:

- No device installed: continue [Codex connection](../codex/connect.md) on the intended Mac.
- Approval pending: perform the [management access check](access.md) if capable, then approve the matching application or hand it to the administrator.
- Offline, incompatible or missing native interface: follow [troubleshooting](../troubleshooting/index.md). OAuth success alone does not resolve these states.

## Help the user start and expand

After the requested installation is ready, give a short, concrete completion message covering these four next-use scenarios. Use the Personal Agents actually connected, the verified device name and the real Server URL. Resolve guide links to the selected version; do not leave placeholders or send the user back to the repository README. Keep these instructions here rather than copying a separate ending into each component or client guide.

1. **Start using it.** Tell the user where to send a request and offer one useful example suited to their goal. For an installed development environment: “In [connected Personal Agent], say: ‘On [device], open a new Codex conversation for the project I choose, review its recent changes and suggest improvements without editing files.’” If the project is already known, name it; otherwise let the user choose it. Explain that they can then continue that conversation through the same Personal Agent. Suggesting this prompt does not authorize sending it. If only `list_connections` has been checked, say connection verification is complete and the first actual task is still theirs to start.
2. **Add another Personal Agent.** Give the existing Server's public `/mcp` URL and the selected version's [client guide](../index.md). Explain that an authorized Agent can create a separate named connection; the user can also create it at the real `/admin/agents` URL. The new client then completes its normal OAuth flow using that connection's access code. Keep the code out of the URL and generic handoff. Reauthorization of the same instance reuses its row. The same Server serves the additional client; do not deploy another Server.
3. **Add another Codex device.** Give a message to use in Codex on the new Mac: “Connect this Mac's Codex to [existing Server URL] using [version-matched Codex connection guide].” Follow [Codex connection](../codex/connect.md) on that Mac; an Agent with management authority can approve the device, otherwise the user approves it at the real `/admin/devices` URL. After approval and verification, the already connected Personal Agents can discover and use it. Use the same Desktop package and existing Server.
4. **Return to management.** Give the fixed, clickable `/admin` URL and explain that the saved password or passkey lets the user approve/revoke devices, create/reissue/revoke Personal Agent connections and manage browser login methods without Wrangler or the original installation Agent. Name the method actually configured; do not call a passkey a password. If browser setup was deferred, say so and point to the existing setup handoff or [setup/recovery instructions](access.md#browser-login-and-recovery); do not claim the page is ready for independent login. The private setup link is for configuration, not the everyday bookmark.

If a stage is incomplete, lead with the exact remaining action and provide only next-use suggestions that are currently possible. Do not present pending authorization as ready, require more clients/devices to finish installation, or start additional installations just because these options are listed. Continue any next action the user has already requested; otherwise leave the choices with them.

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
