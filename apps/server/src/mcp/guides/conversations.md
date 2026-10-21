Write prompts to Codex as direct requests, preserving the user's intent and wording. Add only context the destination needs. Do not prepend third-person delegation boilerplate such as "The user asks you to...", "The user has authorized...", or "I am relaying the user's request...".

Before creating a conversation, resolve model and reasoning effort from the user's explicit choices in the current request or applicable context. Reuse those choices; ask together for any missing choices and wait for the answer before creating. A configuration used by another task alone is not a choice for this task.

app_tools/codex_app.create_thread accepts model/thinking. Its native schema permits omission to use configured defaults; this is how to implement the user's choice to use defaults, not a reason to skip the confirmation above. Omit the corresponding parameters when the user chooses defaults; otherwise pass the resolved choices. Consult app_server/model/list when available choices are needed. Fast is not a creation prerequisite.

App Tools create_thread starts work immediately and has no permission argument. When explicit permissions are required, use an initialization-only prompt and wait for it to finish. Read the settings guide to apply and verify permissions before sending real work. Resolve an unclear permission scope with the user; a task request alone does not select Full Access.

Continue an existing conversation through app_tools/codex_app.send_message_to_thread. For a new idle-thread turn, tracking=thread_turn correlates that exact turn without changing the prompt; model/thinking overrides are preserved. For input to an already running turn, use native tracking. Read the results guide to distinguish the dispatch response from task completion.

To receive desktop approvals, questions and completion notifications, read the interactions guide and follow/subscribe before dispatch.
