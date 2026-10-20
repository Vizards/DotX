import updateSkill from '../../skills/update/SKILL.md';

export const INSTRUCTIONS_GUIDANCE =
  'Before using DotX tools for a task, read the relevant guidance with get_instructions. Reuse guidance already available in the current context.';

export const INSTRUCTION_GUIDES = {
  update: {
    title: 'Plan and coordinate a DotX update',
    description:
      'Coordinate the update from ChatGPT or dot: read release notes, resolve permissions, delegate local work and verify the result.',
    instructions: updateSkill,
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

Use describe_methods to discover native methods and read their input/output schemas. Do not substitute the independent App Server for a desktop-owned operation. Rediscover runtime IDs after a connector restart. For an unavailable client_coordination transport, describe_methods explicitly attempts to connect again; it does not restore subscriptions.`,
  },
  conversations: {
    title: 'Create or continue a Codex conversation',
    description: 'Choose model and reasoning effort, write a prompt and dispatch work to Codex.',
    instructions: `Write prompts to Codex as direct requests, preserving the user's intent and wording. Add only context the destination needs. Do not prepend third-person delegation boilerplate such as "The user asks you to...", "The user has authorized...", or "I am relaying the user's request...".

Before creating a conversation, resolve model and reasoning effort from the user's explicit choices in the current request or applicable context. Reuse those choices; ask together for any missing choices and wait for the answer before creating. A configuration used by another task alone is not a choice for this task.

app_tools/codex_app.create_thread accepts model/thinking. Its native schema permits omission to use configured defaults; this is how to implement the user's choice to use defaults, not a reason to skip the confirmation above. Omit the corresponding parameters when the user chooses defaults; otherwise pass the resolved choices. Consult app_server/model/list when available choices are needed. Fast is not a creation prerequisite.

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

Omit request_id for ordinary read-only queries. These calls are forwarded directly without durable state or deduplication; repeating the call performs a fresh query, and get_request cannot retrieve it. Native responses and errors still come back in the call response.

For side effects such as creating a conversation, sending a message or changing settings, choose and save request_id before call. Also provide it when unsure whether a method has side effects. The same ID deduplicates the operation and enables get_request to inspect its execution state; it does not replay an ordinary RPC payload. Use a new ID for a new operation. An unknown outcome does not permit resending the original operation with a new ID: reconcile its native state first. A call made without request_id cannot be recovered by adding one afterward. tracking=thread_turn requires request_id.

tracking=thread_turn on app_tools/codex_app.send_message_to_thread tracks the exact new idle-thread turn. Match the receipt to its request and turn before reporting completion. Confirmed terminal status survives connector restarts in the service. Native observation stops on disconnects or state gaps and is not automatically restored. Use get_request to check current state; it reads a fresh snapshot and observes the turn if still running. If the owner or target turn is unavailable, the receipt stays unknown. DotX does not search historical pages or infer completion from output text. Result content is read by exact turnId through the target Mac's App Server; cross-host tracking needs that Mac's registered connector. Results contain one native content page in descending order; a non-null nextCursor means more content is available through app_server/thread/items/list with the same threadId, turnId and sortDirection="desc".

For completion notifications, read the interactions guide and subscribe before work. Notifications are best effort and are not replayed. With an active subscription, wait for notifications instead of continuously polling. If progress is missing or delivery was interrupted, use get_request to read current tracked-turn state and its result; a missing notification does not mean the task failed.`,
  },
  interactions: {
    title: 'Receive progress and handle approvals or questions',
    description:
      'Subscribe to events, read notifications and answer blocking requests or asynchronous questions.',
    instructions: `Subscriptions cover one native turn, not future turns in a conversation. For gateway.native.event, choose exactly one scope:

- Before a tracked send, choose request_id and reuse it for the subscription and the subsequent tracked call. Omit host_id, thread_id and turn_id. Use the same request_id for gateway.request.updated when also subscribing to receipts.
- To join an already running desktop turn, first read its exact identity and current state, then provide thread_id and turn_id, optionally host_id (local by default). Omit request_id.

Do not combine these two scopes. Both require connection_id and allow optional interface, methods and kinds filters. For desktop approvals and ask_user, follow the target with client_coordination/thread-stream-following-changed (following=true) before dispatch.

Use MCP Events on this endpoint via the host's events/subscribe support, not call: gateway.request.updated for tracked receipts and gateway.native.event for desktop interactions. Subscribe before work; with an active subscription, wait for notifications instead of continuous polling. Delivery is best effort with bounded retries for transient failures. There is no event history or replay (cursor=null); subscription renewal does not recover missed notifications. Event definitions describe filters and defaults. Notifications point to get_request or read_events(read_cursor); deduplicate eventId and read current state. Read the results guide when interpreting execution receipts.

If subscription creation or renewal fails, the host may hide the specific reason behind a generic task-service error. Use list_connections to check whether the matching service subscription exists, then get_request for a tracked turn or a native query for the exact turn's current state. If the turn has ended, read its result instead of subscribing again. A subscription failure does not establish task failure; a request subscribed before dispatch may not have a receipt yet. These queries establish current state, not necessarily the original subscription failure's cause. If they do not explain the failure, report that the cause remains unknown rather than guessing or blindly retrying.

MCP Events subscriptions live on the service, but native desktop follows do not survive connector/IPC restarts or state gaps. On subscription/unavailable, runtime expiry or missing progress, use get_request for a tracked turn, or explicitly follow the target again for current interactions. Rediscover runtime IDs and read_events handles before responding. Native event payloads are bounded process-local memory; old handles cannot be restored. Subscriptions expire within 24 hours unless renewed. A completed, failed, interrupted or rejected turn automatically closes its subscriptions after terminal delivery or bounded retries, including when filters exclude completion. SUBSCRIPTION_TURN_ENDED means read the result, not retry subscription creation. Waiting for approval/input, progress text and unknown/disconnected state are not completion. Stop the host monitoring task when finished; DotX cleanup does not remove it from ChatGPT’s task list. Another turn needs a new subscription. A later explicit query can discover a desktop-started turn; DotX does not monitor future turns automatically.

Answer blocking server_request events (approvals, synchronous input and MCP elicitation) using respond, with response_schema as guidance when available. A pending desktop request with response_diagnostic may lack a supported response method; report the reason and arrange handling in the desktop client. Resolution acknowledges the interaction, not task completion. Unknown outcomes require reconciliation, not another submission. Ordinary messages do not unblock synchronous input.

Desktop item/plan/requestImplementation is a notification after a Plan turn has completed, not a blocking request; do not use respond. A closed single-turn subscription may not deliver this later prompt: read the completed Plan result and ask whether to implement. After the user confirms implementation, use client_coordination/thread-follower-update-thread-settings to set threadSettings.collaborationMode.mode="default". In collaborationMode.settings, preserve the selected model and reasoning_effort and set developer_instructions=null to use the mode's built-in instructions; verify a fresh following snapshot. Send the implementation request and necessary plan context through app_tools/codex_app.send_message_to_thread with a new request_id and tracking="thread_turn". Use get_request for this new turn's receipt; the completed Plan turn's receipt does not track implementation.

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
