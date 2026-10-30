/* ── Copy ───────────────────────────────────────── */
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';

/** Copies a value and reports success; the caller decides how to show it. */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setError(null);
      setCopied(value);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 2000);
      return true;
    } catch {
      setError(new Error(t.errors.MANUAL_COPY));
      return false;
    }
  }, []);

  return { copy, copied, error };
}
