import { useLayoutEffect } from 'react';

/**
 * Solis go-live checkpoint (2026-09) — Case Detail scroll-to-bottom fix.
 * `components/layout/AppShell.tsx`'s `<main id="main-content">` is the
 * app's real scroll container (`AppShell.module.css`: `overflow-y: auto`),
 * not the browser window/document. That `<main>` is part of the
 * persistent `(portal)` layout, so it is never unmounted on a client-side
 * route change — Next.js's own scroll-restoration-on-navigation only ever
 * resets window/document scroll, so it has no effect on a custom overflow
 * container like this one. Whatever scrollTop `<main>` had on the
 * previous page (e.g. partway down a long Case List) silently carries
 * over into a newly-mounted page that reuses the same `<main>` element —
 * exactly the "Case Detail opens at the bottom" symptom.
 *
 * Deliberately a small, targeted hook a page opts into — not a global
 * route-change listener — so pages that should keep their scroll position
 * across navigation (e.g. the Case List, so Back restores where it was)
 * are never affected. `useLayoutEffect` (not `useEffect`) resets before
 * paint, avoiding a visible flash of the wrong scroll position.
 */
export function useResetMainContentScrollOnChange(key: string | number, containerId = 'main-content'): void {
  useLayoutEffect(() => {
    document.getElementById(containerId)?.scrollTo(0, 0);
  }, [key, containerId]);
}
