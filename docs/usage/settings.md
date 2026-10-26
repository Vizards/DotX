# Change conversation permissions or Fast

Complete: the requested settings are applied and freshly read back. Return to the task waiting to dispatch work; verify actual permissions again when its next turn starts.

Use this guide when the user requests a settings change or requires a particular permission scope before work. Discover the current `client_coordination` method schemas through [connections](connections.md).

## Apply and verify a change

1. Identify the target thread and current host. Follow it with `thread-stream-following-changed`, using `following=true`.
2. Read its latest settings. Resolve an unclear permission scope with the user; preserve unrelated settings.
3. Call `thread-follower-update-thread-settings` for the requested change. Use a retained request ID for this write, following [results](results.md).
4. Require `applied=true`, then read a fresh snapshot of `latestThreadSettings`. Verify the requested fields before sending real work.
5. After the next turn starts, inspect `currentPermissions` for the actual permission profile and approval reviewer. Saved settings alone do not establish a running turn's permissions. Independent App Server permissions can change on desktop handoff, and App Tools controls native setting inheritance.

## Choose the requested settings

| User choice | Fields and constraints |
| --- | --- |
| Workspace access with approvals | Tested combination: permission profile `:workspace`, approval policy `on-request` |
| Full Access without approvals | Tested combination: `:danger-full-access`, approval policy `never`; requires the user's choice of that scope |
| Approve for me | `threadSettings.approvalsReviewer="auto_review"`, `approvalPolicy="on-request"`, and a bounded profile such as `:workspace` |
| Human approval review | `threadSettings.approvalsReviewer="user"` |
| Enable Fast | Change only `threadSettings.serviceTier` to `"priority"` |
| Clear Fast | Change only `threadSettings.serviceTier` to `null` |

Automatic review preserves the sandbox boundary and can decline actions or require human input. `approvalPolicy="never"` leaves no approval request for it to review.

Fast changes the conversation setting, not a running turn. Read a fresh snapshot to verify it; a later App Tools send may replace it with host preferences. Report what was saved and, when a new turn exists, what actually took effect.
