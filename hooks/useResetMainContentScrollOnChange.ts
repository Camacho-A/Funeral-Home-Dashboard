import { useLayoutEffect } from 'react';

/**
 * Solis go-live checkpoint (2026-09) — Case Detail scroll-to-bottom fix,
 * corrected (2026-09, item #9).
 *
 * The original version of this hook only reset `<main id="main-content">`
 * (`AppShell.module.css`: `overflow-y: auto`), on the assumption that this
 * `<main>` was the app's real scroll container. Live-browser verification
 * (real Chromium, not jsdom) disproved that: `.shell` only sets
 * `min-height: 100vh` (never a bounded `height`), so the whole `AppShell`
 * grows to fit its content instead of clipping it — `#main-content`'s
 * `scrollHeight` and `clientHeight` are always equal in practice, so its
 * `overflow-y: auto` never actually engages. The real, currently-live
 * scroll owner is the window/document. Resetting only `#main-content`'s
 * (inert) scrollTop left the window's own scroll position — carried over
 * from whatever page or scroll state preceded this navigation — completely
 * untouched, which is why the original fix did not reliably guarantee
 * top-of-page navigation.
 *
 * This still resets `#main-content` too (harmless, and correct again if a
 * future layout fix ever makes it a real bounded overflow container), but
 * now also resets the window — the container that's actually observed to
 * scroll today.
 *
 * Skips the window reset when the URL already carries a hash fragment on
 * mount, so a legitimate explicit anchor/deep-link is never fought with a
 * forced top reset (no such deep link exists into Case Detail today, but
 * this keeps the hook correct if one is ever added).
 *
 * Deliberately a small, targeted hook a page opts into — not a global
 * route-change listener, and not a change to Next.js/browser scroll
 * restoration — so pages that should keep their scroll position across
 * navigation (e.g. the Case List, so Back restores where it was) are never
 * affected. `useLayoutEffect` (not `useEffect`) resets before paint,
 * avoiding a visible flash of the wrong scroll position.
 */
export function useResetMainContentScrollOnChange(key: string | number, containerId = 'main-content'): void {
  useLayoutEffect(() => {
    document.getElementById(containerId)?.scrollTo(0, 0);
    if (!window.location.hash) {
      window.scrollTo(0, 0);
    }
  }, [key, containerId]);
}
