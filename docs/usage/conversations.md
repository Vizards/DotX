# Start or continue a Codex conversation

First [discover the target and native method schema](connections.md). Write prompts as direct requests, preserving the user's intent and wording. Add only context the destination needs; do not prepend third-person delegation boilerplate such as “The user asks you to…”.

## Start a new conversation

1. Resolve model and reasoning effort from the user's explicit choices in this request or applicable context. Reuse those choices. Ask together for any missing choices and wait before creating; another task's configuration alone is not a choice for this task. Use `app_server/model/list` when available choices are needed.
2. Read the current schema for `app_tools/codex_app.create_thread`. Pass the selected `model` and `thinking`; if the user chooses configured defaults, omit the corresponding parameters. Fast is not a creation prerequisite.
3. Resolve any unclear requested permission scope. `create_thread` starts work immediately and has no permission argument. When explicit permissions must be applied first, create with an initialization-only prompt, wait for it to finish, then [apply and verify settings](settings.md) before sending real work. A task request alone does not select Full Access.
4. Choose and retain a `request_id` before calling `create_thread`. Read the native response for the created thread and host identity. A returned RPC or created thread does not prove the task completed; use [results](results.md).
5. Once the target turn is known, use [interactions](interactions.md) if it needs observation or answers. For subsequent work, prepare the follow/subscription before dispatch as below.

## Continue an existing conversation

1. Read the target's current state. Use the exact thread/host identity and current runtime, not an ID inferred from another conversation.
2. Choose and retain a new `request_id` for this operation. If the turn is idle and the request starts new work, use `tracking="thread_turn"` to correlate that new turn. For input to an already running turn, use `tracking="native"`.
3. If receiving approvals, questions or completion notifications, [follow and subscribe](interactions.md#send-a-new-turn-and-wait) before dispatch. Apply any requested settings first.
4. Call `app_tools/codex_app.send_message_to_thread` with the direct prompt and any explicitly selected model/thinking overrides.
5. Consume the dispatch response, then wait for notifications or reconcile through [the tracked receipt](results.md). Do not report “finished” merely because the send returned.

Example `call` arguments for a user-authorized new turn on an idle thread, with configured model defaults selected. Replace all identities and the prompt with the actual values; inspect the native schema for any required host parameter:

```json
{
  "connection_id": "DEVICE_ID",
  "interface": "app_tools",
  "runtime_id": "CURRENT_RUNTIME_ID",
  "request_id": "operation-unique-id",
  "method": "codex_app.send_message_to_thread",
  "params": {
    "threadId": "TARGET_THREAD_ID",
    "prompt": "Continue with the agreed task."
  },
  "tracking": "thread_turn"
}
```

If dispatch times out or its outcome is unknown, inspect the existing receipt and native state. Do not use another request ID to resend uncertain work. After reauthorization, follow [the recovery checks](../personal-agents/authorization.md#after-reauthorization).
