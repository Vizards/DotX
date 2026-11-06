# Confirm a result or reconcile an uncertain operation

Use after dispatch or an uncertain outcome. Complete: the actual result is known, or uncertainty and the next available check are reported. Return to the user’s task without duplicating unresolved work.

`call` waits for a native RPC response, not completion of the work it starts. Consume `native.result` or its error directly; ordinary RPC payloads are not archived. `rpc_status=returned` means the RPC returned.

## Choose the request behavior before calling

| Operation | Request behavior |
| --- | --- |
| Ordinary read-only query | Omit `request_id`; the response is returned directly, with no durable receipt or deduplication |
| Create a conversation, send a message, change settings, or uncertain side effects | Choose and retain `request_id` before `call`; reuse that ID when inspecting this operation |
| Start a tracked new turn on an idle thread | Provide `request_id` and `tracking="thread_turn"` for `app_tools/codex_app.send_message_to_thread` |

A retained request ID deduplicates the operation and enables `get_request` to read execution state; it does not replay an ordinary RPC payload. A new operation needs a new ID. Adding an ID afterward cannot recover a call originally made without one.

## Follow a dispatched task to its result

1. Read the dispatch response. Distinguish a native error, an accepted operation and a completed task.
2. With an [active subscription](interactions.md), wait for notifications instead of continuous polling. Notifications are best effort and have no replay; a missing notification does not mean the task failed.
3. To reconcile a tracked operation, call `get_request` with its retained ID. Match the receipt to the intended request and exact native turn before reporting completion.
4. Read returned result content. It contains one native content page in descending order. If `nextCursor` is non-null, use `app_server/thread/items/list` on the target Mac with the same `threadId`, `turnId`, `sortDirection="desc"` and the returned cursor, according to its current schema.

`get_request` reads a fresh snapshot and observes the tracked turn if it is still running. Confirmed terminal status persists across connector restarts, but native observation stops on disconnect or state gaps and is not automatically restored. If the owner or exact turn is unavailable, the receipt stays unknown. DotX does not search historical pages or infer completion from output text. Cross-host result reading needs the target Mac's registered connector.

## Recover without duplicating work

When a send times out, a connection drops or an answer is uncertain, inspect the existing receipt and actual native state before acting. An unknown outcome does not permit resending the original operation with a new ID. Native tasks can continue while the remote connection is unavailable.

For an ordinary RPC with a receipt, `get_request` supplies execution metadata, not the original native result body. Query current native state when that body was lost. A query without a request ID has no receipt to recover; repeating it is a fresh query.

After reauthorization, [old receipts and subscriptions do not transfer](../personal-agents/authorization.md#after-reauthorization). Read current native work rather than resending it to recreate a receipt.

## When a receipt expires

Receipts and deduplication normally last 30 days from first creation. `list_connections.record_retention_days` reports the deployed period; `call` receipts and `get_request` return `expires_at` as Unix milliseconds. Reads, retries and status updates do not extend it. An administrator can change the period for remaining records, so recheck the current deadline when needed.

Cleanup can be delayed by a batch or in-flight Server operation; do not rely on a record still existing after its deadline. Once removed, `get_request` returns `REQUEST_NOT_FOUND`, and reusing that request ID can execute a new operation. No permanent deletion marker is retained.

A missing receipt proves neither success nor that the task stopped. Inspect the actual conversation before deciding what to do; never retry uncertain work solely because its receipt disappeared. Cleanup leaves native Codex conversations and tasks intact. To change retention, follow [Server maintenance](../server/retention.md).
