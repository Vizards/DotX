# Check management access

Read this guide when the task involves deployment, approving or revoking a device, managing Personal Agent connections, or changing Server configuration. Ordinary MCP calls do not require this check. Identify the intended Server and inspect available tools; do not assume browser control, a signed-in Cloudflare account, local Codex access or permission to message another Agent.

## Choose the available management path

For a first Server deployment, no DotX management endpoint exists yet. Follow [Server installation](../server/install.md) to select the official Wrangler login and target CF account; Cloudflare authorizes the resource creation/deployment. Run the DotX `session` check after the service is deployed. The steps below apply to an existing service.

Management uses Cloudflare identity. A CF user who can directly modify/deploy the target Worker can administer DotX. Account-wide direct permission covering it also qualifies. Group-only permissions are unsupported in 0.1.0. DotX does not create administrator accounts or passwords.

1. If local execution and the Server release tools are available, run `node admin.mjs --url HTTPS_ORIGIN session` against the intended Server. Use `--profile NAME` when selecting a named official Wrangler login. It obtains the current OAuth credential through official Wrangler and asks the Server to check the actual target Worker permission. Merely finding a Wrangler installation or successful whoami output is not proof. Do not read private Wrangler files, copy tokens, print tokens or add them to handoffs.
2. If that check succeeds, perform the task's management action using the commands below, then read the affected row to verify its state.
3. If permission is absent or the local CLI is unavailable, use the existing authorized management browser session if available. Otherwise give the administrator `/admin/devices` for a device application or `/admin/agents` for a Personal Agent, with the exact pending item and requested action. They can log into Cloudflare there.
4. If a CF request fails temporarily, preserve that error; do not interpret it as missing permission. Missing tooling can be handed to another capable Agent without transferring credentials.

Each CLI invocation obtains the Wrangler credential once. Official Wrangler handles normal OAuth expiry and renewal. A management 401 is returned without automatically fetching another credential or repeating the request; inspect the error and guide recovery of the intended Wrangler login when needed. A 403 means the current identity lacks permission, which signing in again alone cannot repair.

Local Codex installation runs on the Mac being enrolled. Desktop itself does not contain Wrangler or the Server management CLI. A Personal Agent receives only its own OAuth grant, never administrator or device credentials. Every Personal Agent, including the administrator's own, connects through an access code issued for its connection.

Continue the selected task, then [verify and hand off](handoff.md).

## Browser session behavior

Management follows CF's token lifetime and renews an expired access token when the next management request needs it. DotX adds no one-hour login limit or background keepalive. Browser login uses a session cookie; session restoration follows the browser's behavior. Sign out ends that DotX session without contacting CF and leaves Codex and Personal Agent authorizations unchanged.

## Management commands

Run from the Server attachment, or use its absolute `admin.mjs` path. Replace the example values with IDs returned by the service. The optional `--profile NAME` selects the intended official Wrangler login.

```sh
node admin.mjs --url HTTPS_ORIGIN session
node admin.mjs --url HTTPS_ORIGIN device-requests
node admin.mjs --url HTTPS_ORIGIN device-approve --id OPERATION_ID
node admin.mjs --url HTTPS_ORIGIN device-reject --id OPERATION_ID
node admin.mjs --url HTTPS_ORIGIN devices
node admin.mjs --url HTTPS_ORIGIN device-revoke --id DEVICE_ID
node admin.mjs --url HTTPS_ORIGIN agents
node admin.mjs --url HTTPS_ORIGIN agent-create --name 'Personal Agent name'
node admin.mjs --url HTTPS_ORIGIN agent-rename --id AGENT_ID --name 'New name'
node admin.mjs --url HTTPS_ORIGIN agent-reissue --id AGENT_ID
node admin.mjs --url HTTPS_ORIGIN agent-cancel --id AGENT_ID
node admin.mjs --url HTTPS_ORIGIN agent-revoke --id AGENT_ID
```

`agent-create` and `agent-reissue` return a new `access_code` once, together with `expires_at` and `mcp_url`. Deliver the code to its intended enrollment flow with the MCP URL and actual expiry date/time, including timezone. Do not restart the 30-minute lifetime when forwarding it. Read [authorization, expiry and recovery](../personal-agents/authorization.md); never include the code in repository files, public URLs, logs or general handoff documents. Reissue preserves current active access until the new authorization first authenticates to MCP. Cancel ends only an unused code. Revoke ends the connection's active and unfinished authorization.

A management write timeout has an unknown result. Read the affected row before deciding whether to retry; a new code is not recoverable from its stored hash. If the first response was lost, reissue that same row after confirming its identity.
