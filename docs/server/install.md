# Install a DotX Server

Deploy from any suitable local environment; Codex Desktop is recommended, not required. Computer use is optional. This installs one Worker. Local Codex and Personal Agent connection are separate stages that follow it.

## 1. Select the service and release

Reuse the user's chosen target account, Worker name and release. Resolve only missing choices before creating resources. Use a Free-compatible CF account configuration. If this is an interrupted installation, inspect and reuse its verified resources rather than starting another service.

Download the selected DotX Server GitHub Release attachment. Read its README, `release.json`, release notes and `toolchain.json`; use its declared Node/pnpm and official Wrangler versions. Work from the extracted attachment with a separate actual `wrangler.json` for this service. Do not deploy the template's local development values.

0.0.1 installations require a fresh 0.1.0 installation; do not migrate old owner/device tokens. Preserve native Codex accounts, projects and conversations. An existing 0.1.0 service being updated follows [Server update](update.md).

## 2. Check the deployment login

Use official Wrangler to identify the current login and target account. Examples use this release's Wrangler 4.151.0:

```sh
pnpm dlx wrangler@4.151.0 whoami
# Only when a default global login is needed:
pnpm dlx wrangler@4.151.0 login
```

For a named login, reuse its profile. If it needs authentication, use the official profile command, then activate it in the service's working directory:

```sh
pnpm dlx wrangler@4.151.0 auth create PROFILE_NAME
pnpm dlx wrangler@4.151.0 auth activate PROFILE_NAME
pnpm dlx wrangler@4.151.0 whoami
```

`auth create` authenticates or reauthenticates; `auth activate` selects the profile for the directory. Do not repeat them for an already valid active profile. In this version, `login` and `whoami` reject `--profile`; deployment commands and `admin.mjs` can use `--profile PROFILE_NAME` explicitly. Check the selected version's `--help` when needed.

`whoami` identifies the login, not its permission to modify every Worker. CF authorizes the resource operations below. For first installation, defer the DotX management `session` check until the Server exists; there is no administrator claiming/binding step. The deployment account qualifies through its direct target Worker permission, as described in [access](../common/access.md).

## 3. Resolve the Worker and storage

Read the exact selected Worker before creating or deploying it:

```sh
node admin.mjs worker-identity --account ACCOUNT_ID --worker WORKER_NAME
# Only when creating a new Worker:
node admin.mjs worker-create --account ACCOUNT_ID --worker WORKER_NAME
```

These tools obtain official Wrangler OAuth internally and return non-secret identifiers. `worker-identity` reads the exact name without listing other Workers. `worker-create` creates the empty resource without uploading code or writing configuration. Put its returned `worker_id` into `vars.CF_WORKER_ID` before deployment. Do not overwrite an unrelated existing Worker with the same name.

If creation fails or its result is unknown, read the exact name before deciding whether to retry. A failed read is not proof of absence. Reuse the intended Worker and its immutable ID when resuming.

Set the actual configuration's account/name and code/assets paths. Preserve the template's `DEVICES` SQLite DO binding, migration, compatibility settings and asset behavior. For a new service, create OAuth KV storage and retain its returned namespace ID:

```sh
pnpm dlx wrangler@4.151.0 kv namespace create WORKER_NAME-oauth --config /ABSOLUTE/SERVICE/wrangler.json
```

Use a namespace title unique to this service (replace WORKER_NAME in the example); the Worker binding remains `OAUTH_KV`.

Use these non-secret configuration values:

| Configuration | Value |
| --- | --- |
| `name`, `account_id` | The chosen Worker name and CF account ID |
| `main`, `assets.directory` | Paths to this attachment's `worker.mjs` and `public/`; resolve relative to the actual configuration file |
| `vars.PUBLIC_ORIGIN` | The final HTTPS origin, with no trailing slash |
| `vars.SERVICE_ID` | A fresh UUID generated once for this service; preserve across updates |
| `vars.CF_ACCOUNT_ID`, `vars.CF_WORKER_NAME` | The same target account and Worker name |
| `vars.CF_WORKER_ID` | The immutable CF Worker resource ID; obtain before deployment using the commands below |
| `vars.RELEASE_REPOSITORY` | `Vizards/DotX` |
| `vars.RELEASE_CHANNEL` | `stable` by default; choose a prerelease channel such as `dev` or `rc` explicitly. See [release discovery](../maintenance/update.md#release-discovery) |
| `vars.RECORD_RETENTION_DAYS` | `"30"` by default; positive days to retain request receipts, answer deduplication and answer routes. See [adjusting retention](update.md#adjust-record-retention) |
| `kv_namespaces[].id` | The namespace created for the `OAUTH_KV` binding |

## 4. Deploy code and web assets together

Review the actual configuration against the template and release notes. Point both `main` and `assets.directory` to this attachment, resolving paths relative to the configuration file. Then validate and deploy:

```sh
pnpm dlx wrangler@4.151.0 deploy --dry-run --config /ABSOLUTE/SERVICE/wrangler.json
pnpm dlx wrangler@4.151.0 deploy --config /ABSOLUTE/SERVICE/wrangler.json
```

The first code deployment includes the immutable Worker ID. Retain the service URL and non-secret resource/configuration values for maintenance. Wrangler management works now; browser login is ready after the following step.

## 5. Enable Cloudflare administrator login

From the Server attachment, use the authorized Wrangler profile to issue a setup link:

```sh
node admin.mjs --url HTTPS_ORIGIN setup
```

Give the user **only the returned DotX setup link**. Say: “Open this link on any device. It will guide you through creating a temporary Cloudflare API token and pasting it back on the same DotX page. Keep that page open; do not send the token in chat.” No browser automation capability is required of the installation Agent.

The DotX page opens Cloudflare in another tab with **OAuth Client Write** and the target account prefilled. The user checks that this is the only permission, selects **Token expiration → Custom**, sets Start to now and End to one hour later, applies the range, reviews and creates the token. The expiry is a manual choice: CF's template URL does not prefill it. The user copies the token, returns to the original DotX page, pastes it there and selects **Finish setup**.

The Worker creates its private CF OAuth client and saves the client ID/secret in its existing DeviceHub storage. It configures the exact `/admin/callback`, Authorization Code + Refresh Token, Client Secret POST and User Details Read / Memberships Read. CF adds `offline_access`. The temporary API token is used in memory for that request only; it is not returned to the Agent, logged or stored by DotX. The user can revoke it in Cloudflare after completion or let it expire. Do not ask for its value or create a broader token.

Read progress without retrieving credentials:

```sh
node admin.mjs --url HTTPS_ORIGIN setup-status
```

When `configured` is true, ask the user to use **Sign in with Cloudflare** on the completion page. This is the ordinary login/consent for their own new client. No Client ID/secret copying, Wrangler secret input or extra deployment is required. Do not report browser login verified until it actually succeeds.

Setup links last 24 hours. If expired, issue a new one; this replaces the previous unfinished link. If interrupted, check status before issuing another link or repeating creation. Once configured, setup cannot overwrite the login configuration. A network failure can leave the creation outcome unknown: check setup status and the target account's OAuth clients before retrying; an unused client may need removal. Never automatically repeat creation after a timeout.

## 6. Verify and continue

1. Read `/health` and `/setup/info`. Verify the running version, wire, origin and service identity against the selected release and actual configuration.
2. Check management access through `node admin.mjs --url HTTPS_ORIGIN session`, or CF browser login at `/admin`. Confirm `login_configured` is true and the user can sign in to the management page. Follow [access recovery](../common/access.md) for an actual authentication/permission failure.
3. Report Server readiness only after those checks pass. Report CF upstream errors or unavailable GitHub update hints as such; neither establishes a need to recreate resources.
4. If no Codex or Personal Agent exists, continue [connecting Codex](../codex/connect.md) first, then the selected Personal Agent. Do available work; otherwise give the exact next action through [handoff](../common/handoff.md).
