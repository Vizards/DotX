# Find a management path

Use for approving devices, approving PA requests or changing an existing Server. Ordinary MCP use needs no Wrangler check. Return to the requesting task once you have verified management access or identified who will perform it.

For a Server that does not exist yet, use [deployment login](../server/wrangler-login.md), then return to installation.

## Check available access

1. Identify the exact Server and requested action. If local execution is available, use `admin.mjs` from the matching Server release attachment. Desktop does not bundle this tool. Run from the service directory with its installed Wrangler and verified profile; if either is unavailable, [prepare Wrangler and discover the existing login](../server/wrangler-login.md).
2. Run the following, adding `--profile NAME` for a selected profile:

   ```sh
   node /ABSOLUTE/RELEASE/admin.mjs --url HTTPS_ORIGIN session
   ```

   Success verifies the actual target Worker permission. Finding Wrangler or a successful `whoami` alone does not.
3. Return to the requested action and read back its result. Look up only the needed [management command](commands.md).

## If you cannot perform it

| Situation | Next action |
| --- | --- |
| Another Agent has target Worker management access | Hand off the exact action and target using [the management template](handoff.md#hand-off-a-task). No browser login setup is needed |
| An authorized management browser is available | Use `/admin/devices` for devices or `/admin/agents` for PA connections; verify the exact item |
| User wants browser management | Recommend [Sign in with Cloudflare](../server/browser-login.md), then return to the original action. Existing password/passkey methods also work |
| Wrangler cannot start, obtain credentials or return valid JSON | Check the [service directory and CLI capabilities](../server/wrangler-login.md#prepare-the-service-directory), then the selected login and network; do not assume every failure requires login |
| 401 from management | Check the selected official Wrangler login and recover it if needed |
| 403 from management | Obtain a management path with target Worker permission; signing in again alone does not grant it |
| CF/network failure | Preserve the error as an upstream failure, not proof of absent permission. Read state before retrying an uncertain write |
| No known management path | Tell the user which target and action need an administrator; do not ask for raw credentials |

Agent management uses official Wrangler OAuth and direct permission to modify/deploy the target Worker, including account-wide direct permission. Group-only permission is unsupported. `admin.mjs` obtains the credential once per invocation; Wrangler handles normal renewal. Do not read private token files or copy tokens into requests/handoffs.

A failed read is unknown state, not an empty list. The management page displays `N/A` for failed counts and `0` for a successfully read empty result. Retry the read before deciding to install, approve or recreate anything.

Browser management supports Cloudflare, password and Passkey. Cloudflare login checks direct management permission for this Worker; local credentials are independent of Cloudflare membership. Browser login and PA OAuth are separate. A PA's MCP grant is not management access; the same Agent may separately have an authorized Wrangler environment.
