export function Feedback({ error, retry }: { error?: Error | null; retry?: () => void }) {
  if (!error) return null;
  return (
    <p role="alert">
      {error.message} {retry && <button onClick={retry}>Refresh state</button>}
    </p>
  );
}
export function Loading() {
  return <p role="status">Loading…</p>;
}
