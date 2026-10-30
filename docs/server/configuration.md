# Deployment configuration reference

Use only the section requested by [installation](install.md) or [update](update.md). After preparing/verifying the actual configuration, return to that task's deploy step. Use official Wrangler and declarative configuration; no separate deployment state is needed.

## New service values

Preserve the release template's `DEVICES` SQLite DO binding, migration, compatibility settings and asset behavior. Create a namespace unique to this service, keeping the binding name `OAUTH_KV`:

```sh
pnpm dlx wrangler@4.151.0 kv namespace create WORKER_NAME-oauth --config /ABSOLUTE/SERVICE/wrangler.json
```

Use the attachment's toolchain version. Put the returned namespace ID and these non-secret values into the actual configuration:

| Configuration | Value |
| --- | --- |
| `name`, `account_id` | The chosen Worker name and CF account ID |
| `main`, `assets.directory` | Paths to this attachment's `worker.mjs` and `public/`; resolve relative to the actual configuration file |
| `vars.PUBLIC_ORIGIN` | The final HTTPS origin, with no trailing slash; [resolve it below](#resolve-the-service-address) |
| `vars.SERVICE_ID` | A fresh UUID generated once for this service; preserve across updates |
| `vars.CF_ACCOUNT_ID`, `vars.CF_WORKER_NAME` | The same target account and Worker name |
| `vars.CF_WORKER_ID` | The immutable CF Worker resource ID; obtain before deployment using the Worker identity commands in the installation guide |
| `vars.RELEASE_REPOSITORY` | `Vizards/DotX` |
| `vars.RELEASE_CHANNEL` | `stable` by default; choose a prerelease channel such as `dev` or `rc` explicitly. See [release discovery](../maintenance/update.md#release-discovery) |
| `vars.RECORD_RETENTION_DAYS` | `"30"` by default; positive days to retain request receipts, answer deduplication and answer routes. See [adjusting retention](retention.md) |
| `kv_namespaces[].id` | The namespace created for the `OAUTH_KV` binding |

### Resolve the service address

For the default `workers.dev` address, read the selected account's subdomain before deployment using the [Cloudflare API](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/):

```text
GET https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/workers/subdomain
```

Use existing authenticated CF tooling. With only Wrangler available, capture the official `wrangler auth token --json` output inside the calling process, using the selected profile, and send the token only in the CF request's Authorization header. Keep it out of terminal output, files and chat; do not read private credential files. Use the release's Wrangler version.

Read `result.subdomain` from a successful response and set `PUBLIC_ORIGIN` to `https://WORKER_NAME.ACCOUNT_SUBDOMAIN.workers.dev`. Do not derive the subdomain from an email, account display name or profile name. The script-level `/workers/scripts/WORKER_NAME/subdomain` endpoint reports enablement, not the account subdomain.

If authenticated API access is unavailable, inspect **Workers & Pages → Your subdomain** in the selected account's dashboard. If CF reports no registered subdomain, complete its Workers onboarding before continuing; do not rename an existing account subdomain. Ask the user only for a missing choice or action you cannot perform. For an intentionally configured custom domain, use that verified origin instead.

Return to the configuration table. After deployment, compare Wrangler's reported service URL and `/setup/info` with the configured origin.

## Recover deployment configuration on another machine

1. Read `/setup/info` to confirm the public origin and service identity. Obtain the exact CF account and Worker from the existing non-secret deployment records or the Cloudflare dashboard; they are not fields in that public response. Verify the resource in Cloudflare before writing anything.
2. In Cloudflare, open **Workers & Pages → the target Worker → Settings**, and inspect its bindings, variables/secrets and domains/routes. With suitable authenticated CF tooling, the [Worker settings API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/) reads `GET /accounts/{account_id}/workers/scripts/{script_name}/settings`. Use the existing authorized tooling; do not print or transfer Wrangler tokens to construct a request.
3. Reconstruct the actual declarative configuration using those values and the target release's template. Preserve these categories:

| Category | What to preserve |
| --- | --- |
| Target and public identity | Account, Worker name/ID, origin, `SERVICE_ID`, routes and workers.dev exposure |
| Plain variables | Current values, including release repository/channel and record retention; remove retired CF_OAUTH_CLIENT_ID / CF_OAUTH_CLIENT_SECRET bindings only as required by the target release |
| Secrets | Existing secret binding names; keep their values in CF and do not replace them with placeholders |
| Storage | `OAUTH_KV` namespace ID and `DEVICES` Durable Object binding/class; reuse existing resources |
| Runtime | Deployed compatibility settings and other intentional settings, changed only as required by the release |
| Code and web assets | Both `main` and `assets.directory` must point to the target attachment |

The settings response is not a complete deployable project: check domains/routes separately and apply only the target release's required migration history. Do not treat an existing DO as a new resource or blindly rerun initialization from a fresh-install template.

Wrangler 4.151.0 rejects `init --from-dash` for Workers with Assets, which includes DotX. Do not use that command as this version's recovery path. If the current toolchain changes, check its actual supported behavior before relying on it.

If access to configuration is unavailable, request the missing non-secret settings or hand the deployment to an Agent with access. Name the missing field or binding and leave the existing service running.
