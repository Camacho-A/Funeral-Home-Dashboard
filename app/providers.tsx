'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { SessionProvider, DEFAULT_SESSION } from '@/hooks/useSession';

/**
 * App-wide provider composition (Frontend Engineering Plan, Phase 0/4).
 *
 * OrganizationProvider is now wired in (Phase 4) — see
 * docs/adr/ADR-002-multi-tenant-architecture.md.
 *
 * Manors go-live fix (2026-09): SessionProvider is mounted here with a
 * harmless default (`DEFAULT_SESSION` — no staff, empty display name) for
 * routes with no real session at all (e.g. `/login`), exactly mirroring
 * OrganizationProvider's own default-then-overridden pattern.
 * `app/(portal)/layout.tsx` re-mounts it with the real, server-resolved
 * value for every actual portal page.
 *
 * Manors go-live hardening (2026-09): a shared default `retry` — an
 * authorization failure (401/403) is never transient, so retrying it only
 * delays a "not authorized" UI state from appearing (production testing
 * measured ~9s/12 retries on one newly-403ing accounting query before
 * this fix). Every other error keeps the library's normal up-to-3-retries
 * behavior — this is deliberately narrow (recognizing one error shape),
 * not a broader retry/caching redesign. Relies on `error.status` being
 * set by the calling client's own `parseJsonOrThrow` (currently
 * `lib/identityAuthClient.ts` and `lib/accountingClient.ts` — the two
 * implicated in this task); a query whose client doesn't set `.status`
 * simply falls back to the default retry count, unchanged from before.
 */
export function isAuthorizationError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (failureCount, error) => !isAuthorizationError(error) && failureCount < 3,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <SessionProvider value={DEFAULT_SESSION}>{children}</SessionProvider>
      </OrganizationProvider>
    </QueryClientProvider>
  );
}
