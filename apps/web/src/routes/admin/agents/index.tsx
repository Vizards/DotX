import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AccessCodeResult, AgentConnection } from '@dotx/shared/http/admin';
import { sessionQuery } from '../../../queries/session.ts';
import { agentsQuery } from '../../../queries/agents.ts';
import {
  createAgentMutation,
  issueCodeMutation,
  renameAgentMutation,
  cancelCodeMutation,
  revokeAgentMutation,
} from '../../../mutations/agents.ts';
import { ConnectionList, type AgentAction } from './-components/connection-list.tsx';
import { NameForm } from './-components/name-form.tsx';
import { AccessCodePanel } from './-components/access-code-panel.tsx';
import { Feedback, Loading } from '../../../components/feedback.tsx';
import { Guide } from '../../../components/layout.tsx';
export const Route = createFileRoute('/admin/agents/')({ component: Agents });
function Agents() {
  const session = useQuery(sessionQuery());
  const list = useQuery(agentsQuery());
  const csrf = session.data?.authenticated ? session.data.csrf_token! : '';
  const create = useMutation(createAgentMutation(csrf));
  const issue = useMutation(issueCodeMutation(csrf));
  const rename = useMutation(renameAgentMutation(csrf));
  const cancel = useMutation(cancelCodeMutation(csrf));
  const revoke = useMutation(revokeAgentMutation(csrf));
  const [code, setCode] = useState<AccessCodeResult | null>(null);
  const [editing, setEditing] = useState<AgentConnection | null>(null);
  const [copyError, setCopyError] = useState<Error | null>(null);
  const busy = [create, issue, rename, cancel, revoke].some((m) => m.isPending);
  const error = [create, issue, rename, cancel, revoke].find((m) => m.error)?.error;
  function action(kind: AgentAction, agent: AgentConnection) {
    if (kind === 'rename') {
      setEditing(agent);
      return;
    }
    const messages = {
      reissue:
        'End the previous unfinished authorization and issue a new code? Current active access remains until the new token first connects.',
      cancel: 'Cancel this unused access code?',
      revoke:
        'Revoke this Agent’s access and subscriptions? Native Codex tasks already started will continue.',
    };
    if (!window.confirm(messages[kind])) return;
    if (code?.connection.agent_id === agent.agent_id) setCode(null);
    if (kind === 'reissue') issue.mutate(agent.agent_id, { onSuccess: setCode });
    else if (kind === 'cancel') cancel.mutate(agent.agent_id);
    else revoke.mutate(agent.agent_id);
  }
  const url = session.data?.authenticated ? session.data.service.mcp_url : '';
  return (
    <>
      <h1>Personal Agents</h1>
      <p>
        <code>{url}</code>{' '}
        <button
          onClick={() => {
            void navigator.clipboard
              .writeText(url)
              .catch(() => setCopyError(new Error('Select and copy the URL manually.')));
          }}
        >
          Copy MCP URL
        </button>
      </p>
      <p>
        <Guide path="personal-agents/dot/index.md">dot guide</Guide> ·{' '}
        <Guide path="personal-agents/cue/index.md">Cue guide</Guide>
      </p>
      <Feedback error={copyError} />
      <h2>New connection</h2>
      <NameForm
        create
        busy={busy}
        submit={async (name) => {
          try {
            setCode(await create.mutateAsync(name));
            return true;
          } catch {
            /* Mutation shows the server/transport error. */
            return false;
          }
        }}
      />
      <Feedback
        error={error ?? list.error}
        retry={() => {
          void list.refetch();
        }}
      />
      {code && (
        <AccessCodePanel key={code.access_code} value={code} dismiss={() => setCode(null)} />
      )}
      {editing && (
        <section className="panel">
          <h2>Rename {editing.name}</h2>
          <NameForm
            key={editing.agent_id}
            initial={editing.name}
            create={false}
            busy={busy}
            submit={async (name) => {
              try {
                await rename.mutateAsync({ id: editing.agent_id, name });
                setEditing(null);
                return true;
              } catch {
                /* Rendered above. */
                return false;
              }
            }}
            cancel={() => setEditing(null)}
          />
        </section>
      )}
      <button
        disabled={list.isFetching}
        onClick={() => {
          void list.refetch();
        }}
      >
        Refresh
      </button>
      {list.isPending ? (
        <Loading />
      ) : (
        list.data && <ConnectionList agents={list.data.agents} busy={busy} action={action} />
      )}
    </>
  );
}
