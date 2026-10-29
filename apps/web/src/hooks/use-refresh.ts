import { useEffect, useRef, useState } from 'react';

/** A refresh that finishes instantly should still look like it happened. */
export function useRefresh(run: () => Promise<unknown>, minimum = 500) {
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const start = () => {
    if (busy) return;
    setBusy(true);
    const started = Date.now();
    void Promise.allSettled([run()]).then(() => {
      const wait = Math.max(0, minimum - (Date.now() - started));
      timer.current = setTimeout(() => setBusy(false), wait);
    });
  };

  return { busy, start };
}
