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
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <SessionProvider value={DEFAULT_SESSION}>{children}</SessionProvider>
      </OrganizationProvider>
    </QueryClientProvider>
  );
}
