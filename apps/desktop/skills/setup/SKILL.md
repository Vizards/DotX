---
name: setup
description: Set up or resume the first Mac and a self-hosted DotX service, then connect a Personal Agent. To add a Mac to an existing service, use join; for upgrades, use update.
---

# Set up DotX on your first Mac

Lead setup from local Codex on the Mac being connected. Computer use is recommended for Cloudflare and ChatGPT setup; ask the user to handle a specific step when login, consent or missing capabilities require it. Do not assume another Mac is reachable through SSH or remote control. This workflow is complete when the service and this Mac are usable.

## 1. Prepare this Mac

Read [local Desktop installation and verification](references/local-desktop.md) to obtain the published Desktop attachment, install its local marketplace and inspect `setup.mjs status`. For an existing service, continue with [join](../join/SKILL.md) instead of deploying another one. Discovery failure alone is not a reason to create a new service.

## 2. Deploy the service

Obtain the matching, separate **Server attachment** from the repository and version in Desktop's `release.json`. Follow the Server deployment README and its tool requirements using official Wrangler. No Server files or Wrangler version are embedded in Desktop; the prebundled Worker needs no application dependency installation.

Keep the real deployment configuration outside downloaded plugin/cache directories. Set `main` and `assets.directory` to the Worker and `public` directory in the same Server attachment. Preserve the Worker identity, public HTTPS origin, OAuth KV and single DeviceHub bindings when resuming setup.

`node <plugin>/setup.mjs owner-key-hash` creates or reuses the local administrator credential and prints only its SHA-256 digest. Pipe it to Wrangler's `secret put OWNER_KEY_HASH`; never put the original key in chat. Select the resulting service with `select-service --url HTTPS_ORIGIN`.

## 3. Enroll this Mac

Run `init-local`, then `enroll`. On this first Mac holding the administrator credential, `enroll --approve` can approve the Mac within the user's deployment authorization. Association uses the HTTPS service origin, not a platform plugin ID.

`admin-link` on the Mac holding that credential returns a single-use `login_url`, valid for two minutes. Choose the browser session with computer use; the CLI never opens one. Keep this temporary credential out of shared documents.

## 4. Connect the Personal Agent

For the recommended ChatGPT/dot connection, read `HTTPS_ORIGIN/branding/metadata.json` and download `HTTPS_ORIGIN/branding/icon.png` from the deployed service. These public resources need no OAuth. Use `title` for the display name and `description` for the introduction, and upload the PNG through computer use in ChatGPT's normal custom MCP creation page. Do not rely on ChatGPT automatically copying MCP metadata into its plugin listing.

Use `HTTPS_ORIGIN/mcp`, OAuth with Dynamic Client Registration and scopes `mcp:read` and `mcp:write`. Complete consent in the administrator browser session and verify the displayed name, description and icon. Reuse an existing connection to the same service. Other MCP clients connect to that same HTTPS endpoint with their own authorization; they do not need a ChatGPT plugin record.

## 5. Verify and finish

Use the verification steps in [local Desktop installation and verification](references/local-desktop.md). After an interruption, inspect local status, the actual deployment configuration, `/setup/info` and running state, then continue only unfinished steps.

Tell the user that the service and this Mac are ready, and that **other Macs can optionally join later**: on each Mac to add, ask local Codex to follow the [join skill](../join/SKILL.md). A second Mac is not required to finish this installation.

For upgrades, use the installed Desktop update skill and the target Release's notes and `release.json`. ChatGPT/dot coordinates through `get_instructions(goal="update")`. Server deployment and ChatGPT catalog Refresh are separate operations; use normal plugin management, never private refresh APIs or identity overrides.

For problems, read the [online troubleshooting guide](https://github.com/Vizards/DotX/blob/main/docs/troubleshooting/index.md) and follow relevant links.
