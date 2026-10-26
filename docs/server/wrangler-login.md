# Select the deployment login

Use when a task needs a CF account/profile and none has been verified for it. Complete: the intended account is identified through an official Wrangler login. Return to installation or the requesting management task; this check alone does not prove permission over a particular Worker.

## Find an existing login

Use the selected Server attachment's toolchain. Examples use Wrangler 4.151.0:

```sh
pnpm dlx wrangler@4.151.0 auth list
pnpm dlx wrangler@4.151.0 whoami --json
```

`whoami` describes the current directory's login. `auth list` lists saved profiles and bound directories. If the requested account is absent from the current login, inspect a likely profile using `whoami --json --cwd /ABSOLUTE/BOUND_DIRECTORY`. If it has no bound directory, select it in the service directory and check there:

```sh
pnpm dlx wrangler@4.151.0 auth activate PROFILE_NAME /ABSOLUTE/SERVICE
pnpm dlx wrangler@4.151.0 whoami --json --cwd /ABSOLUTE/SERVICE
```

Reuse a verified match. Ask only for unresolved target choices; do not replace other directories' logins or reactivate an already correct profile.

## When no matching login is available

Use `pnpm dlx wrangler@4.151.0 auth create PROFILE_NAME`, let the user complete the official authorization, then select and verify it above. Use `login` only when the user intends to authenticate the default profile. Repeat authorization only when needed, including an expired unfinished device authorization.

A network error is not proof of expired credentials or missing permission. In this Wrangler version, `login` and `whoami` reject `--profile`; deployment commands and `admin.mjs` accept it. Check the selected version's help if behavior differs. Never read or transfer private token files.

Return to the calling task. For a new Server, CF authorizes resource creation/deployment; run the DotX `session` check after deployment. For an existing Server, complete [the target-specific access check](../common/access.md).
