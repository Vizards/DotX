# Select the deployment login

Use when deployment or management needs a verified CF account/profile. Complete: the intended account and login context are identified. This alone does not prove permission over a particular Worker.

## Management tool requirements

DotX's `admin.mjs` invokes `wrangler auth token --json` through PATH and accepts only official Wrangler OAuth credentials. Run it in an environment where that command is available, using the intended working directory and profile. `--profile NAME` selects a named login. Wrangler installation and routine CLI usage follow [Cloudflare's documentation](https://developers.cloudflare.com/workers/wrangler/); DotX does not prescribe an installation method or exact version.

## Find an existing login

Use Wrangler to identify the current login and available accounts, then reuse a verified match for the target. Preserve other profiles and directory bindings. Ask only for unresolved target choices. A working login does not establish permission over the selected Worker; for an existing Server, complete [management access](../common/access.md).

## When no matching login is available

Establish the intended login through official Wrangler authorization, then verify the account. A network or CLI failure is not proof that login has expired. Never read private credential files or expose tokens.

Return to the requesting task. For a new Server, verify management access with `admin.mjs session` after deployment.
