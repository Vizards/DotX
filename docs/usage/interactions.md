# Receive task events and answer questions

Use when the user needs turn observation. Complete: its result is read and any PA monitoring task is stopped. For questions or completed Plans, branch to [answer handling](answers.md) and return afterward.

Use MCP Events through the host's `events/subscribe` support on this endpoint. This is not a DotX `call` method. The host supplies the delivery configuration; do not invent a webhook URL or secret. Subscriptions cover one native turn, not future turns in a conversation.

## Send a new turn and wait

1. [Discover the target and current runtimes](connections.md), read the thread's state, and choose a `request_id` for the new idle-thread send.
2. For desktop approvals and questions, follow the target using `client_coordination/thread-stream-following-changed` with `following=true`.
3. Before dispatch, subscribe to `gateway.native.event` using `connection_id` and that `request_id`. Omit `host_id`, `thread_id` and `turn_id`. If tracking receipt changes too, subscribe to `gateway.request.updated` with the same connection and request ID.
4. Send the work with that request ID and `tracking="thread_turn"`, following [conversations](conversations.md). Inspect its dispatch response.
5. Wait for notifications while the subscription is active. Deduplicate `eventId`, then read current state using `get_request` or `read_events` with the notification's `read_cursor`. Do not continuously poll or treat notification delivery as task completion.
6. [Answer the actual interaction](answers.md), then return to observation. On confirmed completion, read [the result](results.md) and stop any monitoring task you created in the Personal Agent.

For example, the `arguments` object for a pre-dispatch `gateway.native.event` subscription is:

```json
{
  "connection_id": "DEVICE_ID",
  "request_id": "operation-unique-id"
}
```

Use a real selected device and the exact ID reserved for the subsequent send. The complete subscription request follows the host's current MCP Events schema, including its delivery configuration. If that host does not expose Events support, report the unavailable notification capability and use an explicit current-state query when needed; do not invent a replacement background poller.

## Join a turn already running

1. Read the exact thread, turn and host identity and its current state. If the turn has ended, read its result instead.
2. Follow the target for current desktop interactions.
3. Subscribe to `gateway.native.event` with `connection_id`, `thread_id` and `turn_id`; include `host_id` for a non-local host. Omit `request_id`.

Example `arguments` for a local turn:

```json
{
  "connection_id": "DEVICE_ID",
  "thread_id": "TARGET_THREAD_ID",
  "turn_id": "CURRENT_TURN_ID"
}
```

Do not combine the request-ID and exact-turn scopes. Both native-event scopes allow optional `interface`, `methods` and `kinds` filters. Omit `kinds`, or include `notification` as well as `server_request`, to receive async questions. Read the current event catalog for other filters and defaults. Another turn needs a new subscription; DotX does not automatically monitor future turns.

## Renew or finish observation

Subscriptions default to 24 hours. An explicit `ttlMs` must be a positive integer in milliseconds, capped at 24 hours; `null` also uses the default. Read `refreshBefore` in the subscription response, or `refresh_before` in `list_connections`, and renew before that actual deadline. Renewal does not require new OAuth approval. Expiry stops notifications, not native tasks or client authorization.

Completed, failed, interrupted or rejected turns close their subscriptions after terminal delivery or bounded retries, even if filters exclude completion. `SUBSCRIPTION_TURN_ENDED` means read the result rather than subscribe again. Waiting for approval/input, progress text and unknown/disconnected states are not completion. DotX cleanup does not remove monitoring tasks owned by the Personal Agent; stop those when finished.

## Recover missing notifications or a failed subscription

1. If subscription creation/renewal fails, use `list_connections` to see whether the matching service subscription exists. A generic host task-service error may hide the original cause.
2. Use `get_request` for a tracked turn, or a native query for an exact turn's current state. Before dispatch, its receipt may not exist yet. If it ended, read its result instead of subscribing again.
3. After `subscription/unavailable`, runtime expiry, connector/IPC restart or a state gap, rediscover runtimes. Use `get_request` to resume observation of a tracked turn, or explicitly follow the target again for current interactions. Read fresh event handles before responding.
4. If current state does not explain a subscription failure, report that the cause is still unknown. Do not blindly retry or infer native task failure from a notification failure.

Service subscriptions persist, but native follows and event payloads are process-local. Old handles cannot be restored. Delivery is best effort with bounded transient retries; there is no event history or replay (`cursor=null`). Renewal does not recover missed notifications. After reauthorization, follow [the common recovery checks](../personal-agents/authorization.md#after-reauthorization).
