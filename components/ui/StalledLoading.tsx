'use client';

import { useEffect, useState } from 'react';

/**
 * A loading state that admits when it has stopped making progress (2026-10).
 *
 * SOLIS had a failure mode where a route rendered its loading skeleton and
 * then simply stayed there: the server returned the page, the APIs all
 * answered 200, but the portal never finished rendering on the client, so
 * staff sat in front of "Loading…" indefinitely with nothing to act on and
 * no indication anything was wrong. A dashboard reading zero cases, or a
 * case that never opens, is worse than an error — it looks like an answer.
 *
 * So every loading state gets a deadline. Past it, this says so and offers
 * a reload. It cannot fix whatever stalled, but it turns a silent dead end
 * into something a funeral director can see and get out of, which is the
 * difference between "the system is broken" and "the system is stuck,
 * press this".
 *
 * Purely presentational: no data fetching, no authentication, no session or
 * organization state is touched. The timer only ever runs while this
 * fallback is mounted — once the real content renders, React unmounts it
 * and the deadline goes with it.
 */
export function StalledLoading({
  label = 'Loading…',
  /** How long to wait before admitting something is wrong. Long enough not
      to cry wolf over an ordinarily slow page, short enough that nobody
      stares at a dead screen. */
  stalledAfterMs = 12000,
}: {
  label?: string;
  stalledAfterMs?: number;
}) {
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), stalledAfterMs);
    return () => clearTimeout(timer);
  }, [stalledAfterMs]);

  if (!stalled) {
    return (
      <div role="status" style={{ padding: 32 }}>
        {label}
      </div>
    );
  }

  return (
    <div role="alert" style={{ padding: 32, maxWidth: 520 }}>
      <p style={{ margin: '0 0 6px', fontWeight: 600 }}>This is taking longer than usual.</p>
      <p style={{ margin: '0 0 14px', color: 'var(--color-text-secondary)', fontSize: 14 }}>
        The page hasn&rsquo;t finished loading. Your data is safe — nothing has been changed.
      </p>
      <button
        type="button"
        className="sx-btn sx-btn-primary"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}
