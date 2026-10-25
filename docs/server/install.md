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
pnpm dlx wrangler@4.151.0 kv namespace create OAUTH_KV --config /ABSOLUTE/SERVICE/wrangler.json
```

Use these non-secret configuration values; the OAuth client is created in the next step:

| Configuration | Value |
| --- | --- |
| `name`, `account_id` | The chosen Worker name and CF account ID |
| `main`, `assets.directory` | Paths to this attachment's `worker.mjs` and `public/`; resolve relative to the actual configuration file |
| `vars.PUBLIC_ORIGIN` | The final HTTPS origin, with no trailing slash |
| `vars.SERVICE_ID` | A fresh UUID generated once for this service; preserve across updates |
| `vars.CF_ACCOUNT_ID`, `vars.CF_WORKER_NAME` | The same target account and Worker name |
| `vars.CF_WORKER_ID` | The immutable CF Worker resource ID; obtain before deployment using the commands below |
| `vars.CF_OAUTH_CLIENT_ID` | The private CF OAuth client's ID |
| `vars.RELEASE_REPOSITORY` | `Vizards/DotX` |
| `vars.RELEASE_CHANNEL` | `stable` by default; choose a prerelease channel such as `dev` or `rc` explicitly. See [release discovery](../maintenance/update.md#release-discovery) |
| `vars.RECORD_RETENTION_DAYS` | `"30"` by default; positive days to retain request receipts, answer deduplication and answer routes. See [adjusting retention](update.md#adjust-record-retention) |
| `kv_namespaces[].id` | The namespace created for the `OAUTH_KV` binding |

## 4. Configure Cloudflare administrator login

Confirm the final public HTTPS origin before creating its callback. Create a private CF OAuth client in the target account:

| Setting | Value |
| --- | --- |
| Response / grant types | Code; Authorization Code + Refresh Token |
| Token endpoint authentication | Client Secret POST |
| Callback | Exact `HTTPS_ORIGIN/admin/callback` |
| Permissions | User Details Read and Memberships Read |

CF adds the `offline_access` protocol scope for Refresh Token; DotX requests it during login. Set the returned ID as `vars.CF_OAUTH_CLIENT_ID`. Creating the client requires **OAuth Client Write**, separately from normal Wrangler deployment permission. If this capability is missing, hand off this precise account/client configuration step, then resume.

Keep the client private. Store its secret through Wrangler's private input in the next step; never print it, commit it or place it on a command line. CF login/consent and secret input can require the user.

## 5. Deploy code and web assets together

Review the actual configuration against the template and release notes. Point both `main` and `assets.directory` to this attachment, resolving paths relative to the configuration file. Then validate and deploy:

```sh
pnpm dlx wrangler@4.151.0 deploy --dry-run --config /ABSOLUTE/SERVICE/wrangler.json
pnpm dlx wrangler@4.151.0 deploy --config /ABSOLUTE/SERVICE/wrangler.json
pnpm dlx wrangler@4.151.0 secret put CF_OAUTH_CLIENT_SECRET --config /ABSOLUTE/SERVICE/wrangler.json
```

The first code deployment already includes the immutable Worker ID; no second deployment is needed to fill it in. Management remains unavailable until all required identity and OAuth configuration is complete. Retain the service URL and non-secret resource/configuration values for maintenance.

## 6. Verify and continue

1. Read `/health` and `/setup/info`. Verify the running version, wire, origin and service identity against the selected release and actual configuration.
2. Check management access through `node admin.mjs --url HTTPS_ORIGIN session`, or CF browser login at `/admin`. Confirm the management page loads. Follow [access recovery](../common/access.md) for an actual authentication/permission failure.
3. Report Server readiness only after those checks pass. Report CF upstream errors or unavailable GitHub update hints as such; neither establishes a need to recreate resources.
4. If no Codex or Personal Agent exists, continue [connecting Codex](../codex/connect.md) first, then the selected Personal Agent. Do available work; otherwise give the exact next action through [handoff](../common/handoff.md).
