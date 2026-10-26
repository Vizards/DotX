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
| Create a PA connection | `agent-create --name NAME` |
| Reissue / cancel pending enrollment | `agent-reissue --id AGENT_ID` / `agent-cancel --id AGENT_ID` |
| Rename / revoke PA connection | `agent-rename --id AGENT_ID --name NAME` / `agent-revoke --id AGENT_ID` |
| Set up / inspect browser login | `setup` / `setup-status` |
| Recover lost browser login | `reset-login` |

Device rename changes only the Server display name. Revocation stops access; it does not uninstall a plugin or cancel native Codex tasks.

Reissue replaces unfinished enrollment while preserving active access until the new grant first authenticates to MCP. Cancel ends only an unused code. Revoke ends active and unfinished authorization. Create/reissue returns the access code once; use [code delivery](../personal-agents/access-code.md#deliver-and-return).

A timed-out write has an unknown outcome. Read the affected row before retrying. A code cannot be retrieved from its stored hash; if its response was lost, confirm the row and reissue that row.

Return to the task that requested the command and check its completion condition.
