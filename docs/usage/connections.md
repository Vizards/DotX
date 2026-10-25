# Find a Codex and choose its interface

Use this guide before the first native operation, or after a connector restart invalidates previously discovered runtime IDs.

## Discover the target

1. Call `list_connections` and find the intended Mac among the authorized devices. If it is pending, offline or incompatible, follow [troubleshooting](../troubleshooting/index.md#no-usable-codex) before sending work.
2. Select the interface that owns the operation:

| Interface | Purpose |
| --- | --- |
| `app_tools` | Invoke the Codex desktop's tools, including creating or continuing desktop conversations |
| `app_server` | Use an independent local App Server and its native methods |
| `client_coordination` | Reach the actual desktop task owner for following, settings and interactions |

3. Call `describe_methods` for that connection/interface. Read the method's current input/output schema and use the returned runtime identity. Do not substitute the independent App Server for a desktop-owned operation.
4. Use `call` with the discovered connection, interface, runtime and method. Follow [conversations](conversations.md) for task dispatch or [results](results.md) for request IDs and completion checks.

For example, these are `describe_methods` arguments; replace `DEVICE_ID` with the actual `connection_id`:

```json
{
  "connection_id": "DEVICE_ID",
  "interface": "app_tools",
  "method": "codex_app.send_message_to_thread"
}
```

`connection_id` selects the DotX entry point. Native `hostId` and `threadId` parameters select the target within that interface; they are not interchangeable with the device ID. After a connector restart, rediscover runtime IDs. For an unavailable `client_coordination` transport, `describe_methods` explicitly attempts reconnection; it does not restore native follows or subscriptions.

## Interpret additional connection information

`record_retention_days` is the Server's current lifetime for receipts, answer deduplication and response routes. See [receipt expiry](results.md#when-a-receipt-expires).

`updates` is an optional release hint cached across the service. If `updates.status` is `unavailable`, such as `GITHUB_HTTP_403`, continue ordinary use based on connection and interface states. This establishes neither installation failure nor that the version is current. Do not repeatedly query or reinstall to repair a hint; follow [update coordination](../maintenance/update.md) when the user wants an update.
