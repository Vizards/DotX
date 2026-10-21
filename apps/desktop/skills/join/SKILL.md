---
name: join
description: Add this Mac's Codex to an existing DotX service, or resume its device enrollment. Use local Codex on the Mac being added; no new Server deployment is needed.
---

# Add this Mac to DotX

Run this workflow in local Codex on the Mac being added. Computer use is recommended; ask the user for login, consent or steps you cannot perform. Do not assume this Mac can remotely operate another Mac.

## 1. Prepare the local plugin

Read [local Desktop installation and verification](../setup/references/local-desktop.md) to install or inspect the Desktop plugin and run `setup.mjs status`. Keep any existing device identity and service association when resuming.

## 2. Select the existing service

If an authorized DotX Remote is available on the same account, call `list_connections` and save its non-secret `service` object to a file. Use `node <plugin>/setup.mjs select-service --service-file FILE`. Resolve multiple services from context or ask the user.

Without account discovery, ask for the existing service address and use `select-service --url HTTPS_ORIGIN`; it also accepts the MCP URL. Discovery failure alone is not a reason to create another service. This Mac does not need Cloudflare login or a copy of another Mac's administrator key.

## 3. Enroll and approve the Mac

Run `init-local`, then `enroll`. Open or give the user the returned `approval_url` for the administrator's browser session. Verify the displayed device name and fingerprint before approval. If that session is unavailable, Codex on the Mac that manages the service can produce a fresh `admin-link`; do not copy its administrator credential to this Mac or require cross-device remote control.

After approval, run `enroll` again to save the connection. Reuse the existing service and authorized Personal Agent connections; do not create another Server deployment or duplicate ChatGPT Remote record.

## 4. Verify and report

Follow [local Desktop verification](../setup/references/local-desktop.md). Confirm this Mac is connected to the intended service and report its name. After an interruption, inspect status and resume unfinished steps rather than resetting configuration.

For problems, read the [online troubleshooting guide](https://github.com/Vizards/DotX/blob/main/docs/troubleshooting/index.md) and follow relevant links. Use the Desktop update skill for an existing installation's upgrade.
