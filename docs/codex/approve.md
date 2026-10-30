# Approve a Codex application

Use after the local plugin submitted its application to the intended Server. Need: Server URL and device/application identity from the local result. Complete: that exact device is approved; the local Agent then verifies its live connection.

1. [Find a management path](../common/access.md), then return here.
2. Read `device-requests` through the [management CLI](../common/commands.md), or open the exact `application.approval_url` returned by installation. The page highlights that application. Match its identity and target, not just a friendly name; CLI approval always uses the full `operation_id`.
3. Approve the matching request with `device-approve --id OPERATION_ID` or the page action. Read the device afterward. If already approved, do not create another request.
4. Return to [Codex verification](connect.md#verify-and-continue), or tell the waiting local Agent to call `device_status` again. Server notifies the connected plugin; no refresh is needed merely for approval.

Without management capability, hand off this exact approval action. If the user will approve in the browser, explicitly show the actual device name and `application.verification_label` beside the approval link. For example: “Open `APPROVAL_URL`, match ‘My MacBook’ and `7A3F-92C1`, then approve.” Substitute the real values, make the approval URL clickable, and use the user's language. Do not send only a link or ask them to compare full UUIDs. The short label is a visual matching aid, not an access code or approval credential. For an older command result without the label, format the first eight characters of `application.operation_id` in uppercase as `XXXX-XXXX`.

It is valid to leave the stage as “awaiting approval,” not “ready.” An authenticated pending device is idle and cannot execute Codex calls.

If the application expired, was rejected or the device was revoked, follow [reapplication](../troubleshooting/device.md#reapply-with-the-existing-identity). Do not replace its keys to obtain approval.
