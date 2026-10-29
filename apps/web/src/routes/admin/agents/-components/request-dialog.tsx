import { useEffect } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import type { AgentAuthorizationRequest } from '@dotx/shared/http/consent';
import type { ServiceInfo } from '@dotx/shared/http/service';
import { authorizationRequestQuery } from '../../../../queries/authorization.ts';
import { ApiError } from '../../../../api/client.ts';
import { useNow } from '../../../../hooks/use-now.ts';
import { Alert, Loading } from '../../../../components/ui/feedback.tsx';
import { Dialog } from '../../../../components/ui/dialog.tsx';
import { ApprovalForm } from '../../../../components/agent-approval.tsx';
import { Prompt } from '../../../../components/prompt.tsx';
import { fill, t } from '../../../../i18n/index.ts';
export function RequestDialog({
  id,
  csrf,
  service,
  onClose,
}: {
  id: string | null;
  csrf: string;
  service: ServiceInfo;
  onClose: () => void;
}) {
  return (
    <Dialog open={id !== null} title={t.authorize.reviewTitle} kind="modal" onClose={onClose}>
      {id && <RequestReview key={id} id={id} csrf={csrf} service={service} onClose={onClose} />}
    </Dialog>
  );
}
function RequestReview({
  id,
  csrf,
  service,
  onClose,
}: {
  id: string;
  csrf: string;
  service: ServiceInfo;
  onClose: () => void;
}) {
  const request = useQuery(authorizationRequestQuery(id));
  const now = useNow();
  const finished = Boolean(request.data && request.data.phase !== 'waiting');
  useEffect(() => {
    if (finished && !request.error) onClose();
  }, [finished, request.error, onClose]);
  if (request.isPending) return <Loading />;
  if (
    (request.error instanceof ApiError && request.error.code === 'AUTHORIZATION_EXPIRED') ||
    (request.data && request.data.expires_at <= now)
  )
    return (
      <>
        <p className="lede">{t.authorize.expiredRequest}</p>
        <Prompt
          value={fill(t.authorize.restartPrompt, {
            address: service.mcp_url,
            guide: new URL('personal-agents/index.md', service.guides_url).href,
          })}
        />
      </>
    );
  if (request.error) return <Alert error={request.error} retry={() => void request.refetch()} />;
  if (finished) return null;
  return <RequestDecision key={id} request={request.data} csrf={csrf} onClose={onClose} />;
}
function RequestDecision({
  request,
  csrf,
  onClose,
}: {
  request: AgentAuthorizationRequest;
  csrf: string;
  onClose: () => void;
}) {
  const form = useForm({ defaultValues: { name: request.client_name } });
  return (
    <>
      <form.Field name="name">
        {(field) => (
          <label className="field">
            <span>{t.agents.nameLabel}</span>
            <input
              value={field.state.value}
              placeholder={request.client_name}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>
      <p className="lede">{t.authorize.sharing}</p>
      <form.Subscribe selector={(state) => state.values.name}>
        {(name) => (
          <ApprovalForm
            request={request}
            csrf={csrf}
            name={name}
            onApproved={onClose}
            onRejected={onClose}
          />
        )}
      </form.Subscribe>
    </>
  );
}
