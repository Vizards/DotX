# Update Server and web pages

Use for an existing 0.1.0 service. Need: target Server and release. For 0.0.1, use [fresh installation](install.md). Complete: Server runs the target version; report restoration of device links separately.

## Update

1. Read the target Release notes, attachment and toolchain, plus the component scope from [update coordination](../maintenance/update.md). Verify [management access](../common/access.md), then return here.
2. Identify the existing account, Worker, origin, service ID and deployed configuration. If local files are absent or unreliable, [recover the configuration](configuration.md#recover-deployment-configuration-on-another-machine), then return here. Inability to read it is a handoff, not permission to deploy defaults.
3. Compare the target template with actual settings. Preserve account/Worker/URL, `SERVICE_ID`, storage bindings and data, browser login methods, secrets and intentional variables such as `RECORD_RETENTION_DAYS`. Apply only changes required by the target release. Secrets remain in CF; deployment does not require their values. Changing account, Worker or hostname is a separate migration.
4. Point both `main` and `assets.directory` to the target attachment. Follow release-specific migrations/order and use official Wrangler:

   ```sh
   pnpm dlx wrangler@4.151.0 deploy --dry-run --config /ABSOLUTE/SERVICE/wrangler.json
   pnpm dlx wrangler@4.151.0 deploy --config /ABSOLUTE/SERVICE/wrangler.json
   ```

   Substitute the target attachment's toolchain version when different.

## Verify and continue

Read `/health` and check management/public endpoints. Report Server component completion once the target version is running. Separately check devices for authenticated, wire-compatible links and required native interfaces. Temporary Desktop incompatibility does not undo Server completion or justify automatic rollback.

For `changes.remote_catalog=true`, [refresh each Personal Agent's tools](../personal-agents/index.md#refresh-tools) using its client controls or recipe. Preserve existing connections. Return to [update coordination](../maintenance/update.md) for remaining components, then [report completion](../common/handoff.md).

If the target notes require replacing an old development release's CF browser login, follow [browser setup](browser-login.md). Old CF sessions do not become password/passkey sessions. Remove an old CF client only after verifying exclusive use by the retired login and successful replacement; preserve PA OAuth data and unrelated clients.

For a retention-only request, use [adjust retention](retention.md) without treating it as a product update.
