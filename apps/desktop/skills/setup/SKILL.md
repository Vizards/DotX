---
name: setup
description: Install or resume DotX Desktop, self-host DotX Server, connect ChatGPT/dot through DotX Remote, or join an existing service from another Mac. Not for ordinary task dispatch.
---

# Set up DotX

Use local execution and computer-use where available. Ask the user to handle a specific step when login, consent or missing capabilities require it. Adapt to the actual installation rather than restarting setup after an interruption.

When troubleshooting, read the [online troubleshooting guide](https://github.com/Vizards/DotX/blob/main/docs/troubleshooting/index.md) and follow relevant links.

## Installation materials

Use a published GitHub Release's **Desktop attachment**, not the automatically generated source archive. Download and extract it to a persistent directory, then register its local marketplace and install `dotx-desktop` using the installed desktop's native plugin management capabilities. The marketplace identity is `dotx`. Do not upload Desktop over a Remote plugin record.

This file is two levels below the installed plugin directory `<plugin>`, which contains `setup.mjs`. Commands require Node 24.12+; the desktop's signed runtime is at `Contents/Resources/cua_node/bin/node` inside its application. `DOTX_APP_PATH` selects a nonstandard application location. The launcher uses normal desktop loading; its `.mcp.json` working directory is resolved by the desktop loader, whereas argument placeholders are not.

The installed plugin includes `release.json` with its source repository and product version. Use that repository's published Releases to obtain the matching, separate **Server attachment** when a deployment is needed. No Server files or Wrangler version are embedded in Desktop. Do not invent a repository address when using an unpublished development package.

## Select or deploy a service

First inspect `node <plugin>/setup.mjs status`. Local association or configuration does not prove the connector is online. Local state defaults to `~/.local/state/dotx`, overridden by `DOTX_STATE_DIR`.

If an authorized DotX Remote is already available on the same account, call `list_connections` and save its non-secret `service` object to a file. Use `select-service --service-file FILE`. Resolve multiple services from context or ask the user. Without account discovery, `select-service --url HTTPS_ORIGIN` accepts the service origin or MCP URL. Discovery failure alone is not a reason to create another service. A second Mac does not need Cloudflare login.

For a new service, obtain the independent Server attachment and follow its deployment README and tool requirements. Use official Wrangler directly. Keep the real deployment configuration outside downloaded plugin/cache directories, preserving the Worker identity, public HTTPS origin, OAuth KV and single DeviceHub bindings. The prebundled Worker requires no application dependency installation.

`owner-key-hash` creates or reuses the local administrator credential and prints only its SHA-256 digest. Pipe it to Wrangler's `secret put OWNER_KEY_HASH`; never put the original key in chat. Select the resulting service with `select-service --url HTTPS_ORIGIN`.

## Enroll and authorize

- `init-local` creates or reuses the device identity and archived caller without running a model turn. No caller opening or wake message is needed.
- `enroll` submits or checks the same pairing request. On the first Mac holding the administrator credential, `enroll --approve` can approve that Mac within the user's deployment authorization. For another Mac, open the returned `approval_url` in the administrator session, verify its label/fingerprint, obtain the required approval, then run `enroll` again to save the connection.
- `admin-link` on the Mac holding the owner credential returns a single-use `login_url`, valid for two minutes. Choose the browser session with computer-use; the CLI never opens one. Keep this temporary credential out of shared documents.
- In ChatGPT's normal custom MCP interface, create **DotX Remote**, described as “Connect ChatGPT and dot to your Macs’ Codex tasks and receive progress.” Use `HTTPS_ORIGIN/mcp`, OAuth with Dynamic Client Registration and scopes `mcp:read` and `mcp:write`. Complete consent in the administrator browser session. Reuse an existing connection to the same service; another Mac needs neither a duplicate Remote nor renewed account authorization.

## Resume and verify

After an interruption, inspect `status`, the actual deployment configuration, `/setup/info` and running plugin state. `init-local` reuses the caller; `enroll` reuses the device and pairing request. Association uses the HTTPS service origin, not a platform plugin ID.

Read local `device_status` and Remote `list_connections` to verify the loaded connector and interfaces. If a reload is needed, use normal desktop controls at a suitable time around running tasks. Installation does not run test scripts or send synthetic tasks.

For an existing installation's upgrade, use the installed Desktop update skill and the target Release's notes and `release.json`. ChatGPT/dot coordinates through DotX Remote's `get_instructions(goal="update")`. Server deployment and ChatGPT catalog Refresh are separate operations; use normal plugin management, never private refresh APIs or identity overrides.
