# Management command reference

Use after [management access](access.md) is verified. Run from the Server attachment, or use its absolute `admin.mjs` path. Replace placeholders with identifiers read from the target service. Add `--profile NAME` when selecting a named official Wrangler login.

| Task | Command after `node admin.mjs --url HTTPS_ORIGIN` |
| --- | --- |
| Verify management access | `session` |
| Read pending Codex applications | `device-requests` |
| Approve / reject application | `device-approve --id OPERATION_ID` / `device-reject --id OPERATION_ID` |
| Read enrolled devices | `devices` |
| Rename / revoke device | `device-rename --id DEVICE_ID --name NAME` / `device-revoke --id DEVICE_ID` |
| Read PA connections | `agents` |
| Read PA requests / one request | `agent-requests` / `agent-request --id REQUEST_ID` |
| Approve a PA request | `agent-approve --id REQUEST_ID [--name NAME]` |
| Reject a pending PA request | `agent-reject --id REQUEST_ID` |
| Rename / revoke PA connection | `agent-rename --id AGENT_ID --name NAME` / `agent-revoke --id AGENT_ID` |
| Set up / inspect browser login | `setup` / `setup-status` |
| Recover lost browser login | `reset-login` |

Device rename changes only the Server display name. Revocation stops access; it does not uninstall a plugin or cancel native Codex tasks.

PA approval acts on a real OAuth request. Each approval creates a new independent connection; existing connections are never replaced. Revoke explicitly ends that connection’s access and any unfinished authorization. See [request approval](../personal-agents/approval.md).

A timed-out write has an unknown outcome. Read the request or affected row before retrying.

Return to the task that requested the command and check its completion condition.
