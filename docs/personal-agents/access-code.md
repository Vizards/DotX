# Obtain a Personal Agent access code

Use when connecting or reauthorizing a specific Personal Agent instance. Need: the target Server and instance name. Complete: its connection's code and actual deadline are available to the intended enrollment flow.

## Obtain the code

1. [Find a management path](../common/access.md), then return here. An authorized Agent can do this with Wrangler; setting up browser login is not a prerequisite.
2. Read `admin.mjs agents`, or the target Server's `/admin/agents`. Reuse the row for this instance. Create a named row only when adding another instance; a display name alone is not proof that an old row is the intended one.
3. For a new row, use `agent-create --name NAME`; for existing enrollment that needs a fresh code, use `agent-reissue --id AGENT_ID`. See [command syntax](../common/commands.md). Keep an already available, valid code rather than reissuing just to check it.
4. Retain the returned `mcp_url` and actual `expires_at` with the code. If the write response was lost, read the rows before retrying; once the intended row is known, reissue there to replace the lost code.

If another Agent or administrator must perform this task, hand off the Server, instance and row ID if known, plus the requested create/reissue action. Wait for the code to reach the intended enrollment flow before asking the user to open OAuth.

## Deliver and return

Provide the target MCP address, code and expiry date/time with timezone together. The code lasts 30 minutes from issuance; forwarding does not restart that clock. If the deadline is unavailable, state that rather than inventing one.

Keep the code separate from the MCP URL and plugin configuration. Do not put it in source, logs, diagnostic records or general Agent handoffs. It is entered on the DotX page opened by the client's standard OAuth flow, not exchanged directly for tokens by the Agent.

Return to the requesting [dot](dot/index.md#configure-and-authorize) or [Cue](cue/index.md#configure-and-authorize) guide. If authorization is already interrupted, use [the observed OAuth state](authorization.md#recover-an-interruption).
