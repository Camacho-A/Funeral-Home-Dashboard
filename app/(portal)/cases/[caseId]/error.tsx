'use client';

import { useEffect } from 'react';

/**
 * Route-level error state for Case Detail (Frontend Engineering Plan, Phase 0).
 * Established ahead of the page itself (built in Phase 6) so the error-boundary
 * convention exists from the start. Covers cases such as: the case doesn't exist,
 * belongs to a different organization, or failed to load.
 */
export default function CaseDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" style={{ padding: 32 }}>
      <h1>Couldn&apos;t load this case</h1>
      <p>It may have been archived, or it may not belong to this organization.</p>
      <button type="button" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
