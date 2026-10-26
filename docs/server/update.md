# Update Server and web pages

Read [access](../common/access.md) and [update coordination](../maintenance/update.md). Use the target release's Server attachment and notes.

1. Identify the existing account, Worker, public URL and service ID. Read the running version. Obtain the current deployed configuration and bindings from Cloudflare using official Wrangler/CF APIs, including when working on another machine. Local installation files are not a prerequisite.
2. Compare the target template with current deployment configuration. Preserve account, Worker, URL, service ID, DO/KV resources, browser login methods, secrets, authorization data and the chosen RECORD_RETENTION_DAYS. Apply only changes required by the target release; never replace the entire actual configuration with the default template. Do not recreate a missing-looking resource without checking its remote identity.
3. Point both main and assets.directory to the target attachment's code and public files. Follow release-specific migration/order requirements and deploy with official Wrangler. This updates all web pages and MCP implementation together.
4. Verify /health reports the target version and check the service's own management/public endpoints. This establishes component completion. Separately inspect devices and report which links are authenticated, wire-compatible, online and expose the required interface. A temporarily incompatible Desktop does not mean the Server update failed or justify automatic rollback.
5. If remote_catalog changed, route each Personal Agent to its own client guide for the normal catalog refresh. Do not assume ChatGPT, recreate connections or repeat OAuth merely to refresh definitions.

Changing account, Worker or public URL is a separate migration, not an ordinary update. For 0.0.1 → 0.1.0 use [installation](install.md). Finish with [handoff](../common/handoff.md).

From the extracted target Server attachment, confirm permissions using `node admin.mjs --url HTTPS_ORIGIN session`. After merging the actual existing bindings/vars with required release changes, validate and deploy:

```sh
pnpm dlx wrangler@4.151.0 deploy --dry-run --config /ABSOLUTE/SERVICE/wrangler.json
pnpm dlx wrangler@4.151.0 deploy --config /ABSOLUTE/SERVICE/wrangler.json
```

Use the target attachment's actual toolchain version if it differs from this example. Password verifiers, passkey public keys and browser sessions live in DeviceHub; preserve that DO. Earlier development releases used CF OAuth browser login. When updating one of those releases, follow the target Release notes to set up password/passkey login once through Wrangler. Old CF browser sessions do not become password/passkey sessions. Existing CF OAuth client registrations can be removed from CF after confirming they belong only to the retired DotX browser login and the new login works; do not remove unrelated clients or Personal Agent OAuth data.

Keep unrelated Worker secrets in Cloudflare; deployment does not require retrieving their values. Do not generate a new `SERVICE_ID` as a routine update. If the current configuration is unavailable locally, recover it using the path below before deployment; inability to inspect it is a handoff, not permission to substitute defaults.

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

## Adjust record retention

`RECORD_RETENTION_DAYS` is a non-secret Worker environment variable. It defaults to 30 when omitted and accepts positive days, including fractions; zero, negative, non-finite and unrepresentable timestamp values are invalid. It controls request receipts, answer deduplication and response routes, not OAuth lifetimes or Codex conversations.

With the user's requested period, update `vars.RECORD_RETENTION_DAYS` in the service's actual Wrangler configuration and deploy that configuration with its current code, bindings and other variables preserved. For example, `"RECORD_RETENTION_DAYS": "60"` keeps records for 60 days. An administrator can also edit the same plain-text variable in the Worker settings and deploy the change; keep the deployment configuration in sync so a later update preserves it. Follow [access](../common/access.md) when handing this operation to an authorized Agent or administrator. DotX's management page does not add a separate setting.

The new period applies to all remaining records from their original creation time. Reducing it can immediately make older records eligible for deletion; increasing it does not recover data already deleted. Reads, status updates, token refresh and repeated calls do not restart the retention clock. One native interaction's routes and answer records share the clock that starts when DotX first records that interaction. DO alarms clean due groups in batches; in-flight server operations finish before their groups are removed. Cleanup never cancels native tasks or removes device/Agent enrollment. Existing notification subscription/retry cleanup and Desktop interaction-handle release still follow their own lifecycles; they do not wait for this retention period.

After deployment, verify the actual deployed variable through Cloudflare. If an authorized Personal Agent is already available, also read `list_connections.record_retention_days` and, where a receipt exists, its `expires_at`. Otherwise record the MCP check as pending; do not create a Personal Agent or dispatch a task solely to verify the setting. A saved local configuration alone does not establish the deployed value. Existing development records are indexed once: calls retain `created_at`; old interaction records without timestamps start at the first indexing run. Read [receipt expiry](../usage/results.md) before retrying old operations.
