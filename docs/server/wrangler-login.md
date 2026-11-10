# Select the deployment login

Use when a task needs a Wrangler installation or CF account/profile that has not been verified. Complete: an official Wrangler installation is available and the intended account is identified. Return to installation or the requesting management task; this check alone does not prove permission over a particular Worker.

## Prepare the service directory

Run login, deployment and management commands from the persistent directory containing the service's actual `wrangler.json`, outside the release attachment. Use Node and pnpm compatible with the release's `toolchain.json`; its `wrangler` field records the build version, not an exact installation requirement.

Check `pnpm exec wrangler --version` and reuse the available official installation. If missing, install it once in this directory with `pnpm add -D wrangler@latest`. Maintain this dependency and its lockfile here; update it when needed for security fixes or required commands. See [Cloudflare's installation guide](https://developers.cloudflare.com/workers/wrangler/install-and-update/).

The management tool uses `pnpm exec wrangler auth token --json` in this same directory; it does not install or update Wrangler. Check support with `pnpm exec wrangler auth token --help`, without printing a token. Use the selected release's absolute `admin.mjs` path when running management commands.

## Find an existing login

From the service directory:

```sh
pnpm exec wrangler auth list
pnpm exec wrangler whoami --json
```

`whoami` describes the current directory's login. `auth list` lists saved profiles and bound directories. If the requested account is absent from the current login, inspect a likely profile using `whoami --json --cwd /ABSOLUTE/BOUND_DIRECTORY`. If it has no bound directory, select it in the service directory and check there:

```sh
pnpm exec wrangler auth activate PROFILE_NAME /ABSOLUTE/SERVICE
pnpm exec wrangler whoami --json --cwd /ABSOLUTE/SERVICE
```

Reuse a verified match. Ask only for unresolved target choices; do not replace other directories' logins or reactivate an already correct profile.

## When no matching login is available

Use `pnpm exec wrangler auth create PROFILE_NAME`, let the user complete the official authorization, then select and verify it above. Use `login` only when the user intends to authenticate the default profile. Repeat authorization only when needed, including an expired unfinished device authorization.

A network error or failed CLI invocation is not proof of expired credentials or missing permission. Check the installed command's `--help` for supported options; select a profile for `whoami` through its bound directory as above. Deployment commands and `admin.mjs` accept `--profile`. Never read or transfer private token files.

Return to the calling task. For a new Server, CF authorizes resource creation/deployment; run the DotX `session` check after deployment. For an existing Server, complete [the target-specific access check](../common/access.md).
