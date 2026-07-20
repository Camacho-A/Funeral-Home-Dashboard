'use client';

import { useEffect } from 'react';

/**
 * Global error boundary (Frontend Engineering Plan, Phase 0). Catches any
 * otherwise-unhandled render/runtime error across the app. Route-level error
 * boundaries (e.g. app/(portal)/cases/[caseId]/error.tsx) take precedence for
 * their own segment; this is the last-resort fallback.
 */
export default function GlobalError({
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
      <h1>Something went wrong</h1>
      <p>An unexpected error occurred. You can try again, or go back to the dashboard.</p>
      <button type="button" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
