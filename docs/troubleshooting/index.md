# DotX troubleshooting

Start here when installing, updating or using DotX. Match the symptom below; as this guide grows, follow links to the relevant pages in this directory.

## Two plugins appear

Two plugins are expected:

- **DotX Remote** gives ChatGPT/dot access to your self-hosted DotX Server through its `/mcp` endpoint.
- **DotX Desktop** runs on each Mac and connects its native Codex desktop to that server.

They have separate roles and installation identities. Keep both for the complete connection; do not merge their identities or remove either as a duplicate. Additional entries from obsolete installations are a separate cleanup issue.

## Codex cannot open ChatGPT's plugin settings

Browser use may refuse access to `chatgpt.com` with `A saved user permission setting blocks this action` or `A saved permission or managed policy denies access`. This is a host browser permission, separate from DotX authorization and the Codex task's command permissions. Full Access does not override it.

Choose either path:

1. **Allow browser access and continue in Codex.** On the Mac running the affected task, open the desktop app's **Settings → Computer Use**, then **Manage** for the browser being used. Under **Website permissions**, allow browsing `chatgpt.com` and remove any blocking rule for that site. After access is allowed, an existing conversation may still retain its earlier denial; start a new local Codex conversation to continue the unfinished step through the normal browser permission flow. Restarting the desktop app alone did not clear the old conversation's denial in our test. If access is still denied, stop and use the manual path rather than editing permission files or bypassing the restriction.
2. **Complete the browser step yourself.** For an update, open ChatGPT in your signed-in browser, go to its plugin settings, select the existing **DotX Remote** entry and click **Refresh tools**. Wait for the refresh to finish, then tell the executing Codex conversation that you completed it. Codex can continue checking the available tools and actual connection state. Record Refresh as manually completed; do not create a replacement plugin, redo OAuth or reinstall DotX just to refresh its catalog.

## dot still sees old tool definitions after an update

An existing dot can retain old tool descriptions or parameter schemas even after DotX Remote's catalog is refreshed. Calls may reach the updated Server and return new results while dot still lacks the parameters needed to use them.

1. Check the running Server version and refresh DotX Remote through ChatGPT's normal plugin settings if its catalog changed.
2. Compare the tool declarations visible to the affected dot with a fresh ChatGPT conversation. Use a read-only call to check the actual response. A successful new-chat test does not establish that an existing dot has refreshed; the plugin's display name is not the running Server version.
3. If only the existing dot retains old definitions, consider its **Restart** menu action. ChatGPT's dialog says conversations, memories and scheduled tasks are retained, but ongoing work may be interrupted; choose the timing accordingly. After restart, verify the declarations and a read-only call using the changed parameters.

In one development test, dot still declared `get_instructions(args: {})` while the Server returned the new guide directory. After Restart, dot saw the optional `goal` parameter and successfully read `get_instructions({"goal":"settings"})`. This is an observed recovery path, not a platform guarantee or a mandatory step for every update. This case did not require deleting dot, reinstalling the plugin or redeploying Server.

## Notifications intermittently fail with Cloudflare HTTP 403

During development, some outgoing MCP Events callbacks from DotX Server to OpenAI were rejected by Cloudflare's edge protection. Retrying often succeeded. This observation concerns notification delivery, not every HTTP 403 involving Cloudflare.

DotX automatically retries recognized edge denials up to nine times after the initial attempt. Let those retries run. A notification delivery failure does not establish that the native Codex task failed; check the original request with `get_request` or read the current native state. Do not resend the task to repair a notification.

If delivery still fails, inspect the callback destination, response and delivery diagnostics. The observed edge denial is classified as `edge_denied`. Application-level or authorization 403 responses are not retried by this policy. A 401/403 returned by your own DotX endpoint requires separate authorization or service diagnosis.

## dot intermittently refuses to dispatch work through MCP

dot sometimes declines to dispatch local Codex/ChatGPT work through an available, authorized MCP, saying computer tasks must use its built-in `cloud_threads` route. It may successfully discover DotX connections and methods, then stop before calling the execution method. This is a dot-side routing decision before dispatch, not an error returned by DotX or the target Codex task. Missing tools, failed authorization and actual MCP errors require separate diagnosis.

Development tests observed both outcomes:

- Direct MCP dispatch completed real file writes, isolated package uninstallation and updates, with native execution and completion results verified.
- Other runs declined even a read-only `/bin/pwd` task before dispatch, while conversation management and plain-text messages still worked through the same MCP tool.

The behavior is inconsistent; it does not establish a blanket ban on MCP operations with side effects. An OpenAI-defined routing restriction may explain dot's stated reason, but neither that policy nor the cause of the inconsistent behavior has been independently confirmed. Similar reports and our test findings are recorded in [openai/codex#51797](https://github.com/openai/codex/issues/51797#issuecomment-6248115244).

Deleting and recreating dot restored execution in some tests but failed to do so in others. Restarting dot or adding a Custom rule also did not provide a reliable fix. **Do not recommend deleting dot as a routine recovery step; deletion is irreversible.** There is no established creation-date cutoff or reliable workaround for this symptom.

For a report, record the request, dot's response, the available tools and whether execution was actually dispatched. Keep ordinary permission or scope questions separate from a refusal. If dot stops before dispatch, reinstalling DotX or broadening the target task's permissions is not a demonstrated remedy. A user can choose to continue the work in local Codex, but that does not validate or repair dot's MCP dispatch path.
