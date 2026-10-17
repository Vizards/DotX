# DotX Server

This independent Release attachment contains the prebundled Worker and a Wrangler template. It hosts DotX Remote, OAuth, device enrollment and one DeviceHub Durable Object. No application dependencies or Desktop plugin are included.

## Deploy with GPT

Read `release.json` for the product/protocol version and source repository. `toolchain.json` records the official Wrangler version used for this Server release; it is a deployment tool requirement, not a Desktop version constraint. Use official Wrangler directly, for example `npx --yes wrangler@<version> whoami`, `login`, `deploy` and `secret put`.

Keep your real Wrangler configuration outside the downloaded attachment and plugin cache. Start from `wrangler.json`, select the account and Worker name, set `main` to this attachment's absolute `worker.mjs` path, and set the actual HTTPS `PUBLIC_ORIGIN`. Preserve `OAUTH_KV`, `DEVICES`, DeviceHub migrations and the single hub identity. Save any provisioned resource IDs in your deployment configuration. The template's `RELEASE_REPOSITORY` is populated by GitHub Actions and enables public stable-release discovery without a GitHub token.

Use DotX Desktop's `setup.mjs owner-key-hash` to create or reuse the administrator credential. Pipe its digest to `wrangler secret put OWNER_KEY_HASH --config <your-config>`. The original key stays on the administrator's Mac. Complete the Desktop setup skill to enroll devices and authorize ChatGPT/dot.

`RELEASE_CHANNEL` defaults to `stable`. Set it to `dev` only on a deployment whose owner chooses development updates. The dev channel discovers published `-dev.*` Pre-releases; neither channel includes Drafts. Discovery is cached for six hours per repository and channel and never installs an update automatically.

## Update

Use the target Release's `update-SKILL.md` and release notes to determine which components need updates. Deploy through the existing configuration and resources; change the code path and target-required fields, without replacing credentials or clearing DO data. Preserve the service origin and OAuth connection.

Deployment updates Remote's running code. A changed tool catalog, schema or model instructions also requires Refresh in ChatGPT's normal plugin management. Read `/health` and authenticated `list_connections` to verify the running Server, protocol and connections. Installation/update does not run project tests or dispatch synthetic tasks.
