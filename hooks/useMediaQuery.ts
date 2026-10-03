import { useEffect, useState } from 'react';

/**
 * SOLIS Tasks/Calendar/Settings phase, §2.5 — a small `matchMedia` wrapper,
 * SSR-safe (defaults to `false` until mounted, since `window` doesn't exist
 * server-side). Used to pick the mobile fallback view for Calendar's
 * week/month without touching the underlying `view` state or data fetch.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches);
    }
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}
