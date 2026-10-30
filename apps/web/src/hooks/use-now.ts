import { useEffect, useState } from 'react';

/** A ticking clock for countdowns; reads state, never polls a server. */
export function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);

  return now;
}
