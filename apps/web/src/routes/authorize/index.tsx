import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { authorizationQuery } from '../../queries/authorization.ts';
import { ConsentForm } from './-components/consent-form.tsx';
import { Feedback, Loading } from '../../components/feedback.tsx';
export const Route = createFileRoute('/authorize/')({
  validateSearch: (search: Record<string, unknown>) => ({
    transaction: typeof search.transaction === 'string' ? search.transaction : '',
  }),
  component: Authorize,
});
function Authorize() {
  const { transaction } = Route.useSearch();
  const query = useQuery(authorizationQuery(transaction));
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <>
        <Feedback
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
        <p>Return to your Personal Agent to start authorization again.</p>
      </>
    );
  return <ConsentForm context={query.data} />;
}
