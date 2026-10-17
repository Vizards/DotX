# DotX troubleshooting

Start here when installing, updating or using DotX. Match the symptom below; as this guide grows, follow links to the relevant pages in this directory.

## Two plugins appear

Two plugins are expected:

- **DotX Remote** gives ChatGPT/dot access to your self-hosted DotX Server through its `/mcp` endpoint.
- **DotX Desktop** runs on each Mac and connects its native Codex desktop to that server.

They have separate roles and installation identities. Keep both for the complete connection; do not merge their identities or remove either as a duplicate. Additional entries from obsolete installations are a separate cleanup issue.

## Notifications intermittently fail with Cloudflare HTTP 403

During development, some outgoing MCP Events callbacks from DotX Server to OpenAI were rejected by Cloudflare's edge protection. Retrying often succeeded. This observation concerns notification delivery, not every HTTP 403 involving Cloudflare.

DotX automatically retries recognized edge denials up to nine times after the initial attempt. Let those retries run. A notification delivery failure does not establish that the native Codex task failed; check the original request with `get_request` or read the current native state. Do not resend the task to repair a notification.

If delivery still fails, inspect the callback destination, response and delivery diagnostics. The observed edge denial is classified as `edge_denied`. Application-level or authorization 403 responses are not retried by this policy. A 401/403 returned by your own DotX endpoint requires separate authorization or service diagnosis.

## dot refuses to invoke an installed MCP

First check whether DotX Remote's tools are available and its authorization is valid. Missing tools or failed authorization are different from dot declining to call an available tool.

In one developer's test, a dot initialized before October 5, 2026 refused to invoke the installed MCP. Deleting that dot and initializing a new one resolved the behavior. This is a single-user observation: the cause is unconfirmed, the date is not a verified compatibility cutoff, and recreating dot is not a guaranteed fix.

If the symptoms match and ordinary connection checks do not explain them, explain this optional workaround to the user. **Deleting dot is irreversible and may discard its history or other information.** Preserve needed material first and proceed only if the user explicitly chooses deletion after understanding the consequences. Do not delete dot automatically or treat recreation as a way around legitimate tool restrictions.
