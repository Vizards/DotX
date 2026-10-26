# Install a DotX Server

Use for a new service. Need: a suitable execution environment, target CF account, Worker name and release. Browser automation and access to the user's Mac are not required. Complete: the intended Server is running and management access works.

If this is an interrupted installation, inspect and reuse its resources. For an existing 0.1.0 service, use [Server update](update.md). 0.0.1 requires a fresh installation; preserve native Codex accounts, projects and conversations.

## Install

1. Resolve missing target/release choices. Download the selected Server Release attachment and read its README, release notes, `release.json` and `toolchain.json`. Use its Node/pnpm and official Wrangler versions. Prepare a separate actual `wrangler.json`; do not deploy template development values.
2. [Select or establish the Wrangler login](wrangler-login.md), then return here with the verified target account/profile.
3. From the attachment, look up the exact selected Worker. Create it only when absent and intended:

   ```sh
   node admin.mjs worker-identity --account ACCOUNT_ID --worker WORKER_NAME
   # Only for a new Worker:
   node admin.mjs worker-create --account ACCOUNT_ID --worker WORKER_NAME
   ```

   Add `--profile NAME` for a named login. Save the returned immutable Worker ID. If creation has an unknown result, read the exact name before retrying. A failed read does not prove absence; do not overwrite an unrelated Worker.
4. Fill the [deployment configuration](configuration.md#new-service-values), including that ID, and create the service's OAuth KV namespace as described there. Return here once the actual bindings/vars and code/assets paths are ready.
5. Review and deploy with official Wrangler, using the release's toolchain version (4.151.0 in this release):

   ```sh
   pnpm dlx wrangler@4.151.0 deploy --dry-run --config /ABSOLUTE/SERVICE/wrangler.json
   pnpm dlx wrangler@4.151.0 deploy --config /ABSOLUTE/SERVICE/wrangler.json
   ```

## Verify and continue

Read `/health` and `/setup/info`; verify version, wire, public origin and service identity. Check that `/admin` loads. Run `node admin.mjs --url HTTPS_ORIGIN session` with the selected profile. On failure, use [management access recovery](../common/access.md); do not recreate resources to fix upstream errors.

Retain the service URL and non-secret deployment configuration. Offer [password/passkey setup](browser-login.md) for independent browser management; it can be completed now or later. Record deferred setup and continue through Wrangler.

Follow [the next action](../common/handoff.md#choose-the-next-action): normally connect the first Codex, then the intended Personal Agent. Hand off only the part you cannot execute.
