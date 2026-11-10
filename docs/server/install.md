# Install a DotX Server

Use for a new service. Need: a suitable execution environment, target CF account, Worker name and release. Browser automation and access to the user's Codex computer are not required. Complete: the intended Server is running and management access works.

If this is an interrupted installation, inspect and reuse its resources. For an existing service, read [update coordination](../maintenance/update.md) and use the flow appropriate to its current and target releases.

## Install

1. Resolve missing target/release choices. Download the selected Server Release attachment and read its README, release notes, `release.json` and `toolchain.json`. Meet its Node/pnpm requirements. Prepare a persistent service directory with a separate actual `wrangler.json`; do not deploy template development values.
2. [Prepare Wrangler and select the login](wrangler-login.md), then return here with the verified target account/profile. Continue running commands from that service directory.
3. Use the selected attachment's management tool to look up the exact selected Worker. Create it only when absent and intended:

   ```sh
   node /ABSOLUTE/RELEASE/admin.mjs worker-identity --account ACCOUNT_ID --worker WORKER_NAME
   # Only for a new Worker:
   node /ABSOLUTE/RELEASE/admin.mjs worker-create --account ACCOUNT_ID --worker WORKER_NAME
   ```

   Add `--profile NAME` for a named login. Save the returned immutable Worker ID. If creation has an unknown result, read the exact name before retrying. A failed read does not prove absence; do not overwrite an unrelated Worker.
4. Fill the [deployment configuration](configuration.md#new-service-values), including that ID, and create the service's OAuth KV namespace as described there. Return here once the actual bindings/vars and code/assets paths are ready.
5. Review and deploy with the service directory's official Wrangler:

   ```sh
   pnpm exec wrangler deploy --dry-run --config /ABSOLUTE/SERVICE/wrangler.json
   pnpm exec wrangler deploy --config /ABSOLUTE/SERVICE/wrangler.json
   ```

## Verify and continue

Read `/health` and `/setup/info`; verify version, wire, public origin and service identity. Check that `/admin` loads. Run `node /ABSOLUTE/RELEASE/admin.mjs --url HTTPS_ORIGIN session` with the selected profile. On failure, use [management access recovery](../common/access.md); do not recreate resources to fix upstream errors.

Retain the service URL and non-secret deployment configuration. Give the user `/admin` and recommend [Sign in with Cloudflare](browser-login.md) for browser management. Password/Passkey setup is optional when the user prefers another method. Agent management continues through Wrangler.

Follow [the next action](../common/handoff.md#choose-the-next-action): normally connect the first Codex, then the intended Personal Agent. If no PA is connected and none is chosen, offer to help connect one and ask which client the user wants. Hand off only the part you cannot execute.
