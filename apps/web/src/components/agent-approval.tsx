import { useMutation } from '@tanstack/react-query';
import type { AgentAuthorizationRequest } from '@dotx/shared/http/consent';
import { approvalMutation } from '../mutations/authorization.ts';
import { Alert } from './ui/feedback.tsx';
import { Button } from './ui/button.tsx';
import { t } from '../i18n/index.ts';

/** Same explicit approval on the original OAuth page and in management. */
export function ApprovalForm({
  request,
  csrf,
  name,
  onApproved,
  onRejected,
}: {
  request: AgentAuthorizationRequest;
  csrf: string;
  name?: string;
  onApproved?: (request: AgentAuthorizationRequest) => void;
  onRejected?: () => void;
}) {
  const mutation = useMutation(approvalMutation(csrf));
  const decide = (decision: 'approve' | 'reject') =>
    mutation.mutate(
      {
        transaction: request.transaction,
        decision,
        ...(decision === 'approve' && name !== undefined ? { name } : {}),
      },
      { onSuccess: (result) => (decision === 'approve' ? onApproved?.(result) : onRejected?.()) },
    );
  return (
    <>
      <Alert error={mutation.error} />
      <div className="consent-acts">
        <Button
          variant="solid"
          large
          busy={mutation.isPending && mutation.variables?.decision === 'approve'}
          disabled={mutation.isPending}
          onClick={() => decide('approve')}
        >
          {t.authorize.approve}
        </Button>
        <button
          type="button"
          className="linkbtn linkbtn--danger"
          aria-busy={mutation.isPending && mutation.variables?.decision === 'reject'}
          disabled={mutation.isPending}
          onClick={() => decide('reject')}
        >
          {mutation.isPending && mutation.variables?.decision === 'reject'
            ? t.forms.working
            : t.authorize.reject}
        </button>
      </div>
    </>
  );
}
