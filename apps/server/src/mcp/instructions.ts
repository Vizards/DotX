export const INSTRUCTIONS_GUIDANCE =
  'Before using DotX tools for a task, read the relevant guidance with get_instructions. Reuse guidance already available in the current context.';

export const INSTRUCTION_GUIDES = {
  update: {
    title: 'Plan and coordinate a DotX update',
    description:
      'Read the target release workflow and settle the update scope and execution permissions before delegating local work.',
    instructions: `The ChatGPT, dot or local Codex conversation receiving the user's update request coordinates the update. Read the target Release's update skill yourself before creating an execution task or dispatching update work; passing its link to another conversation does not complete this step. list_connections provides running versions and an updates.latest.update_skill_url hint; use the user's chosen release when specified. The web-readable source is https://raw.githubusercontent.com/Vizards/DotX/<release-tag>/apps/desktop/skills/update/SKILL.md with the target Release tag substituted; the Release's update-SKILL.md attachment has the same contents. If the guide cannot be read, report that blocker instead of creating a task to read it.

Use that skill to settle scope, permissions and execution order with the user. Pass the agreed choices to local executors; do not delegate unresolved user choices or answer them on the user's behalf. Read the conversations and settings guides when creating or configuring an execution conversation.`,
  },
  connections: {
    title: 'Find connections and choose an interface',
    description:
      'Discover Macs, select an entry point and distinguish the three native interfaces.',
    instructions: `Use list_connections to discover authorized Macs and their available interfaces. connection_id selects an entry point; hostId and threadId inside native params select the target.

DotX exposes three interfaces:
- app_tools invokes the desktop's tools.
- app_server runs an independent local App Server.
- client_coordination reaches the actual desktop task owner.

Use describe_methods to discover native methods and read their input/output schemas. Do not substitute the independent App Server for a desktop-owned operation. Rediscover runtime IDs after a connector restart.`,
  },
  conversations: {
    title: 'Create or continue a Codex conversation',
    description: 'Choose model and reasoning effort, write a prompt and dispatch work to Codex.',
    instructions: `Write prompts to Codex as direct requests, preserving the user's intent and wording. Add only context the destination needs. Do not prepend third-person delegation boilerplate such as "The user asks you to...", "The user has authorized...", or "I am relaying the user's request...".

Before creating a conversation, resolve model and reasoning effort from the user's request or applicable context; ask together for missing choices. app_tools/codex_app.create_thread accepts model/thinking. Consult app_server/model/list when available choices are needed. Fast is not a creation prerequisite.

App Tools create_thread starts work immediately and has no permission argument. When explicit permissions are required, use an initialization-only prompt and wait for it to finish. Read the settings guide to apply and verify permissions before sending real work. Resolve an unclear permission scope with the user; a task request alone does not select Full Access.

Continue an existing conversation through app_tools/codex_app.send_message_to_thread. For a new idle-thread turn, tracking=thread_turn correlates that exact turn without changing the prompt; model/thinking overrides are preserved. For input to an already running turn, use native tracking. Read the results guide to distinguish the dispatch response from task completion.

To receive desktop approvals, questions and completion notifications, read the interactions guide and follow/subscribe before dispatch.`,
  },
  settings: {
    title: 'Change conversation permissions or Fast',
    description:
      'Apply desktop-owned settings and verify the permissions or Fast state that takes effect.',
    instructions: `Follow the target with client_coordination/thread-stream-following-changed (following=true), then use thread-follower-update-thread-settings to update the requested settings.

For permissions, resolve an unclear scope with the user. Tested permission-profile/approval-policy combinations are :workspace/on-request and :danger-full-access/never.

To request Approve for me, set threadSettings.approvalsReviewer="auto_review", with approvalPolicy="on-request" and a bounded permissions profile such as ":workspace". To request human review, set approvalsReviewer="user". Automatic review preserves the sandbox boundary; approvalPolicy="never" leaves no approval request to review. It can still decline actions or require human input.

Require applied=true and a fresh snapshot of latestThreadSettings before sending real work. After the next turn starts, inspect currentPermissions to verify its actual permissions and approval reviewer; saved settings alone do not establish the active turn's permissions. Independent App Server permissions may change on desktop handoff, and App Tools controls native setting inheritance.

On an explicit Fast change, update only threadSettings.serviceTier: priority enables Fast; null clears it. Read a fresh snapshot to verify the setting. This changes the conversation setting, not a running turn; a later App Tools send may replace it with host preferences.`,
  },
  results: {
    title: 'Confirm execution results or reconcile an uncertain outcome',
    description:
      'Interpret call responses, inspect exact-turn receipts and handle restarts without duplicate sends.',
    instructions: `call waits for the native RPC response, not task completion. Consume native.result/error from that response; ordinary RPC payloads are not archived. rpc_status=returned means the RPC returned, not that the task finished.

Save request_id before call. Use get_request to inspect execution state or a tracked-turn receipt. Reusing request_id does not replay an ordinary RPC payload. Use a new ID for a new query; an unknown outcome does not permit resending the original operation with a new ID. Reconcile its native state first.

tracking=thread_turn on app_tools/codex_app.send_message_to_thread tracks the exact new idle-thread turn. Match the receipt to its request and turn before reporting completion. Execution metadata survives connector restarts in the service; tracked result content is read from the native thread and requires an online connector. Cross-host tracking also needs the target Mac's registered connector to locate the turn.

For completion notifications, read the interactions guide and subscribe before work. With an active subscription, wait for notifications and inspect the referenced receipt instead of continuously polling.`,
  },
  interactions: {
    title: 'Receive progress and handle approvals or questions',
    description:
      'Subscribe to events, read notifications and answer blocking requests or asynchronous questions.',
    instructions: `For desktop approvals and ask_user, follow the target with client_coordination/thread-stream-following-changed (following=true) before dispatch.

Use MCP Events on this endpoint via the host's events/subscribe support, not call: gateway.request.updated for tracked receipts and gateway.native.event for desktop interactions. Subscribe before work; with an active subscription, wait for notifications instead of continuous polling. Event definitions describe filters and defaults. Notifications point to get_request or read_events(read_cursor); deduplicate eventId and read current state. Read the results guide when interpreting execution receipts.

Subscriptions survive reconnects, but runtime IDs and native interaction handles must be rediscovered. Native event payloads are bounded process-local memory. A gap, expired runtime or missed pre-upload notification requires reading the current native snapshot; old handles cannot be restored. The MCP client renews subscriptions (up to 24 hours).

Answer blocking server_request events (approvals, synchronous input and MCP elicitation) using respond and their response_schema. Resolution acknowledges the interaction, not task completion. Unknown outcomes require reconciliation, not another submission. Ordinary messages do not unblock synchronous input.

Desktop request_user_input_async is a notification, not a server_request. Reply through app_tools/codex_app.send_message_to_thread as a direct answer with enough question context. Use native tracking while its turn is running; thread_turn tracking is for a new idle-thread turn. Notifications report a question occurrence, not whether it is still unanswered; the connector keeps no per-question answer state. Subscribe without a kinds filter, or include notification as well as server_request, to receive async questions. Followed turn status events still report completion. On a new answer turn, verify any required permissions through currentPermissions; App Tools controls native setting inheritance.`,
  },
  troubleshooting: {
    title: 'Troubleshoot installation, updates or runtime behavior',
    description: 'Find the maintained troubleshooting guide for problems using DotX.',
    instructions:
      'Read https://github.com/Vizards/DotX/blob/main/docs/troubleshooting/index.md and follow relevant links.',
  },
};

export type InstructionGoal = keyof typeof INSTRUCTION_GUIDES;

export function getInstructions(goal?: InstructionGoal) {
  if (goal) return { goal, ...INSTRUCTION_GUIDES[goal] };
  return {
    guides: Object.entries(INSTRUCTION_GUIDES).map(([goal, { title, description }]) => ({
      goal,
      title,
      description,
    })),
  };
}
