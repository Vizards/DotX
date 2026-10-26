# Approve a Codex application

Use after the local plugin submitted its application to the intended Server. Need: Server URL and device/application identity from the local result. Complete: that exact device is approved; the local Agent then verifies its live connection.

1. [Find a management path](../common/access.md), then return here.
2. Read `device-requests` through the [management CLI](../common/commands.md), or open `/admin/devices`. Match the device/application identity and target, not just a friendly name.
3. Approve the matching request with `device-approve --id OPERATION_ID` or the page action. Read the device afterward. If already approved, do not create another request.
4. Return to [Codex verification](connect.md#verify-and-continue), or tell the waiting local Agent to call `device_status` again. Server notifies the connected plugin; no refresh is needed merely for approval.

Without management capability, hand off this exact approval action. It is valid to leave the stage as “awaiting approval,” not “ready.” An authenticated pending device is idle and cannot execute Codex calls.

If the application expired, was rejected or the device was revoked, follow [reapplication](../troubleshooting/device.md#reapply-with-the-existing-identity). Do not replace its keys to obtain approval.
