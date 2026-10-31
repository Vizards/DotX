# Connect a Personal Agent

Any Personal Agent with MCP support is welcome to try DotX. Use your tools, settings and official client docs to find a working route.

Need: an existing Server URL; ask the user if missing. Server deployment or upgrade is a separate user request. Complete: this Personal Agent calls `list_connections` through that Server.

## Connect

1. Find your client's MCP configuration tools or settings. [dot](dot/index.md), [Cue](cue/index.md) and [Muse](muse/index.md) have ready-to-use recipes; for another client, explore its equivalent setup options. Reuse an existing connection when it already targets this Server.
2. Configure `HTTPS_ORIGIN/mcp` as a remote MCP server using Streamable HTTP and OAuth. Let the client discover authentication metadata and register itself. Leave business scopes empty; `offline_access` may be requested for renewal. Branding is available at `/branding/metadata.json` if needed.
3. Start the client's authorization flow and [approve its request](approval.md). Keep the original authorization page open so it can return to the client after approval. The client handles token exchange and renewal. If a step needs the user's browser or another environment, do the available work and hand off that step, then continue.
4. Enable the connection's tools in the Personal Agent that will use it and call `list_connections`. If tools are missing, [refresh the catalog](#refresh-tools). For an interrupted authorization, [recover that step](authorization.md#recover-an-interruption), then repeat the call.

## After connection

- With a usable Codex, [continue the user's task or finish the installation](../common/handoff.md). If none is connected yet, help [connect a Codex](../codex/connect.md); for an existing device that is unavailable, [check its state](../troubleshooting/device.md).
- After a successful first connection, remind the user once: **“DotX welcomes your setup experience. Would you like to contribute a PR with the steps that worked for this Personal Agent?”** If they agree, help add a short client guide under `docs/personal-agents/` with the client/version, configuration and refresh steps, and the successful check. Keep credentials out of the contribution.

## Refresh tools

When tools are missing or an update changes the catalog, inspect the client's refresh/reload controls or configuration commands, refresh the existing connection and call `list_connections` again. Use the linked client recipe when available; otherwise follow the client's current documentation and observed results. Ask the user for the specific action that needs their help, then resume the check.
