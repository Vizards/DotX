# DotX Server package

This independent attachment contains a bundled Worker, all web pages and branding in `public/`, an official Wrangler template, a local `admin.mjs` management tool and version-matched Agent guides. Desktop is a separate attachment.

Start at [the guide index](../../docs/index.md), [Server installation](../../docs/server/install.md) or [Server update](../../docs/server/update.md). `release.json` identifies the release, wire version and component changes; `toolchain.json` records the Node requirement and the pnpm/Wrangler build versions, which do not constrain the user's Wrangler installation. The target GitHub Release notes describe version-specific installation and update requirements.

Keep the actual deployment configuration outside this attachment. Deploy `worker.mjs` and `public/` together as one Worker, with one SQLite DeviceHub DO and OAuth KV. Agent management uses Wrangler's direct permission to modify the target Worker. Browser management recommends Cloudflare sign-in through the public DotX relay; no CF OAuth client is needed. Password and Passkey are optional alternatives stored in this service's DeviceHub.

The management CLI invokes `wrangler auth token --json` through PATH, using the caller's [Wrangler login context](../../docs/server/wrangler-login.md). Run the selected attachment's tool where that CLI is available:

```sh
node /ABSOLUTE/RELEASE/admin.mjs --url https://YOUR_WORKER.workers.dev session
node /ABSOLUTE/RELEASE/admin.mjs --help
```

Use `--profile NAME` when the intended login uses a named Wrangler profile. The CLI prints management results, never Cloudflare tokens. Desktop does not include this tool or Wrangler.

For installation, `worker-create --account ACCOUNT_ID --worker NAME` creates the empty Worker and returns its ID before code deployment. `worker-identity` with the same arguments reads an existing Worker by exact name. Set that ID in the deployment configuration and follow the installation guide for one normal Wrangler deployment.

After deployment, give the user `/admin` and recommend [Cloudflare sign-in](../../docs/server/browser-login.md). No local credential setup is required for that path. If the user prefers a password or Passkey, `node /ABSOLUTE/RELEASE/admin.mjs --url HTTPS_ORIGIN setup` returns a private setup link. `setup-status` returns non-secret readiness, and the Agent can continue managing the service through Wrangler. `reset-login` explicitly creates a recovery link; successful completion replaces browser credentials and sessions without changing connected Codex or Personal Agents. See the installation and access guides for the complete handoff.

The public MCP endpoint is `/mcp`. Service discovery is `/setup/info`; client metadata and icon are `/branding/metadata.json` and `/branding/icon.png`. Each Personal Agent starts standard OAuth. A browser administrator or a Wrangler-authorized installation Agent approves its pending request; the original authorization page then continues to the client callback.

The template serves `/assets/*` and `/branding/*` through Cloudflare Static Assets without executing the Worker. Keep `public/_headers` with the assets to preserve their response headers. Other paths enter the Worker; only declared page routes return the HTML shell. Keep `html_handling` and `not_found_handling` set to `none` so unknown API paths never fall back to the web page.
