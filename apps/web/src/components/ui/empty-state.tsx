import { Button } from './button.tsx';
/** Empty lists share the same hierarchy and a visible way to add the first item. */
export function EmptyState({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{description}</p>
      <Button variant="solid" onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}
