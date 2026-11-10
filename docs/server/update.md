# Update Server and web pages

Use when the target release supports updating the existing service in place. Need: target Server and release; check [upgrade boundaries](../maintenance/update.md#identify-the-current-and-target-versions) first. Complete: Server runs the target version; report restoration of device links separately.

## Update

1. Read the target Release notes, attachment and toolchain, plus the component scope from [update coordination](../maintenance/update.md). The new management tool requires `wrangler` on PATH with the intended login context. Verify [management access](../common/access.md), then return here.
2. Identify the existing account, Worker, origin, service ID and deployed configuration. If local files are absent or unreliable, [recover the configuration](configuration.md#recover-deployment-configuration-on-another-machine), then return here. Inability to read it is a handoff, not permission to deploy defaults.
3. Compare the target template with actual settings. Preserve account/Worker/URL, `SERVICE_ID`, storage bindings and data, browser login methods, secrets and intentional variables such as `RECORD_RETENTION_DAYS`. Apply only changes required by the target release. Secrets remain in CF; deployment does not require their values. Changing account, Worker or hostname is a separate migration.
4. Point both `main` and `assets.directory` to the target attachment. Follow release-specific migrations/order, then dry-run and deploy the actual configuration with official Wrangler and the verified account/profile. Reuse the existing Wrangler installation; a DotX update does not require matching its build version.

## Verify and continue

Read `/health` and `/setup/info`; verify the target version, wire, public origin and preserved service identity. Check that an HTTP GET to `/admin` returns 200 with an HTML content type, and run `admin.mjs --url HTTPS_ORIGIN session` with the selected profile. These checks complete the Server update. If public endpoints are not ready after deployment, use [deployment availability recovery](../troubleshooting/index.md#after-a-server-deployment). Separately check devices for authenticated, wire-compatible links and required native interfaces. Temporary Desktop incompatibility does not undo Server completion or justify automatic rollback.

For `changes.remote_catalog=true`, [refresh each Personal Agent's tools](../personal-agents/index.md#refresh-tools) using its client controls or recipe. Preserve existing connections. Return to [update coordination](../maintenance/update.md) for remaining components, then [report completion](../common/handoff.md).

Cloudflare browser login uses the public DotX relay; users do not create an OAuth client. Preserve existing passwords, passkeys and browser sessions when updating. Recommend [Cloudflare login](browser-login.md) for new browser access; `setup` and `reset-login` remain optional local-credential actions.

For a retention-only request, use [adjust retention](retention.md) without treating it as a product update.
