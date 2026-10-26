# Install a DotX Server

Deploy from any suitable local environment; Codex Desktop is recommended, not required. Computer use is optional. This installs one Worker. Local Codex and Personal Agent connection are separate stages that follow it.

## 1. Select the service and release

Reuse the user's chosen target account, Worker name and release. Resolve only missing choices before creating resources. Use a Free-compatible CF account configuration. If this is an interrupted installation, inspect and reuse its verified resources rather than starting another service.

Download the selected DotX Server GitHub Release attachment. Read its README, `release.json`, release notes and `toolchain.json`; use its declared Node/pnpm and official Wrangler versions. Work from the extracted attachment with a separate actual `wrangler.json` for this service. Do not deploy the template's local development values.

0.0.1 installations require a fresh 0.1.0 installation; do not migrate old owner/device tokens. Preserve native Codex accounts, projects and conversations. An existing 0.1.0 service being updated follows [Server update](update.md).

## 2. Check the deployment login

Inspect existing official Wrangler profiles before proposing a new login. Examples use this release's Wrangler 4.151.0:

```sh
pnpm dlx wrangler@4.151.0 auth list
pnpm dlx wrangler@4.151.0 whoami --json
```

`whoami` describes the login selected for the current directory, not every saved login. `auth list` lists profile names and their bound directories; a profile name alone does not establish its account. If the requested account is not in the current login, inspect a likely existing profile by running `whoami --json --cwd /ABSOLUTE/BOUND_DIRECTORY` in one of its listed directories. If there is no bound directory, select that profile in the service's working directory and check it there. Reuse a verified match; ask the user to choose only when the deployment target is still missing or ambiguous.

Select the matching profile for this service, without replacing other directories' logins:

```sh
pnpm dlx wrangler@4.151.0 auth activate PROFILE_NAME /ABSOLUTE/SERVICE
pnpm dlx wrangler@4.151.0 whoami --json --cwd /ABSOLUTE/SERVICE
```

Only if no matching login exists, or the selected profile actually needs reauthentication, use `pnpm dlx wrangler@4.151.0 auth create PROFILE_NAME`, then select and verify it as above. Use `login` only when the user intends to authenticate the default profile. Do not infer expired credentials or missing permission from a network failure. Do not repeat authentication or activation for an already valid active profile. In this version, `login` and `whoami` reject `--profile`; deployment commands and `admin.mjs` can use `--profile PROFILE_NAME` explicitly. Check the selected version's `--help` when needed.

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

The first code deployment includes the immutable Worker ID. Retain the service URL and non-secret resource/configuration values for maintenance. Wrangler management works now. Browser login is optional and can be set up now or later.

## 5. Offer browser login

From the Server attachment, use the authorized Wrangler profile to issue a setup link:

```sh
node admin.mjs --url HTTPS_ORIGIN setup
```

Give the returned DotX link to the user: “Open this link on any device and choose a password or passkey for your DotX management page. You can add the other method later. Enter the password only on that page.” The user stays on their own Worker. The installation Agent needs no browser automation and never needs the password or passkey private key.

The page saves the selected login method and signs the browser in. `/admin/security` lets the user add a password, add more passkeys or remove a method while retaining at least one. Future visits use the fixed `/admin` address. Passkeys are tied to the service hostname; a different hostname requires a new passkey.

Explain the benefit in user terms: this login lets them open their management page from another device to approve Codex devices, manage Personal Agent connections and change login methods without finding the installation Agent or a Wrangler environment. It is separate from each Personal Agent's OAuth connection. Include the fixed management URL in the [completion message](../common/handoff.md#help-the-user-start-and-expand).

Check non-secret progress with:

```sh
node admin.mjs --url HTTPS_ORIGIN setup-status
```

`configured: true` means a password or passkey is saved. Report a browser login as verified only when the user or an observed browser actually enters the management page. If the user defers browser setup, continue installing Codex and Personal Agents through Wrangler; report browser login as deferred, not a failed Server installation.

Setup links last 24 hours. Issuing another replaces the unfinished link. Check `setup-status` after an interrupted response; a consumed link cannot be used again. Once configured, `setup` leaves existing login methods alone. For forgotten credentials, follow [browser-login recovery](../common/access.md#browser-login-and-recovery).

## 6. Verify and continue

1. Read `/health` and `/setup/info`. Verify the running version, wire, origin and service identity against the selected release and actual configuration.
2. Check management access through `node admin.mjs --url HTTPS_ORIGIN session`. If browser setup was chosen, also check `login_configured` and confirm the user can enter `/admin`; otherwise record that optional step as deferred. Follow [access recovery](../common/access.md) for an actual authentication/permission failure.
3. Report Server readiness only after those checks pass. Report CF upstream errors or unavailable GitHub update hints as such; neither establishes a need to recreate resources.
4. If no Codex or Personal Agent exists, continue [connecting Codex](../codex/connect.md) first, then the selected Personal Agent. Do available work; otherwise give the exact next action through [handoff](../common/handoff.md).
