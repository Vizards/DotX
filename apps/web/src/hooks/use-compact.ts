import { useEffect, useState } from 'react';

const query = '(max-width: 760px)';

/** True on phone widths, where a table becomes a card list. */
export function useCompact() {
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return compact;
}
