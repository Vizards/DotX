# Answer a Codex interaction

Use after receiving a current question/approval, or when the user chooses to implement a completed Plan. Need: the actual target and current event/context. Complete: the response is acknowledged, or the new implementation turn is dispatched and tracked. Return to [observation](interactions.md) or [result confirmation](results.md); an answer is not task completion.

## Answer the interaction that actually occurred

| Event | Action |
| --- | --- |
| Blocking `server_request`: approval, synchronous input or MCP elicitation | Use `respond` for its current event ID, following `response_schema` when available |
| Pending request with `response_diagnostic` | Inspect the reason; if the response method is unsupported, arrange handling in the desktop client |
| `request_user_input_async` notification | Send a direct answer with enough question context through `app_tools/codex_app.send_message_to_thread` |
| `item/plan/requestImplementation` notification | Read the completed Plan and use the separate implementation flow below; do not call `respond` |

Ordinary messages do not unblock synchronous requests. A successful `respond` acknowledges that interaction, not completion of the task. Reconcile an unknown answer outcome before submitting again.

Async notifications describe a question occurrence, not whether it remains unanswered; the connector keeps no per-question answer state. Check current context before replying. Use native tracking while its turn is running; `thread_turn` tracking is for a new idle-thread turn. On a new answer turn, verify any required `currentPermissions`; App Tools controls native setting inheritance.

Answer deduplication and response routes normally last 30 days from the first recorded occurrence of that interaction. `respond.expires_at` reports the deadline; reading again or repeating an answer does not extend it. After cleanup, `respond` returns `EVENT_NOT_FOUND` until a current event is read again. Read native state before answering; old answer deduplication no longer applies. See [retention and recovery](results.md#when-a-receipt-expires).

## Continue a completed Plan with implementation

`item/plan/requestImplementation` is a notification after the Plan turn completed. A closed single-turn subscription may not deliver it, so read the completed Plan result and ask whether to implement.

After the user confirms:

1. Follow the target and use `thread-follower-update-thread-settings` to set `threadSettings.collaborationMode.mode="default"`.
2. In `collaborationMode.settings`, preserve the selected `model` and `reasoning_effort`; set `developer_instructions=null` to use the mode's built-in instructions. Verify a fresh following snapshot.
3. Prepare a new request ID and subscriptions, then send the implementation request and needed plan context through `app_tools/codex_app.send_message_to_thread` with `tracking="thread_turn"`.
4. Read this new turn's receipt with `get_request`. The completed Plan receipt does not track implementation.
