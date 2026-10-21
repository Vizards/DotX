Follow the target with client_coordination/thread-stream-following-changed (following=true), then use thread-follower-update-thread-settings to update the requested settings.

For permissions, resolve an unclear scope with the user. Tested permission-profile/approval-policy combinations are :workspace/on-request and :danger-full-access/never.

To request Approve for me, set threadSettings.approvalsReviewer="auto_review", with approvalPolicy="on-request" and a bounded permissions profile such as ":workspace". To request human review, set approvalsReviewer="user". Automatic review preserves the sandbox boundary; approvalPolicy="never" leaves no approval request to review. It can still decline actions or require human input.

Require applied=true and a fresh snapshot of latestThreadSettings before sending real work. After the next turn starts, inspect currentPermissions to verify its actual permissions and approval reviewer; saved settings alone do not establish the active turn's permissions. Independent App Server permissions may change on desktop handoff, and App Tools controls native setting inheritance.

On an explicit Fast change, update only threadSettings.serviceTier: priority enables Fast; null clears it. Read a fresh snapshot to verify the setting. This changes the conversation setting, not a running turn; a later App Tools send may replace it with host preferences.
