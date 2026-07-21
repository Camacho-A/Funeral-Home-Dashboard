'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationProvider } from '@/hooks/useOrganization';

/**
 * App-wide provider composition (Frontend Engineering Plan, Phase 0/4).
 *
 * OrganizationProvider is now wired in (Phase 4) — see
 * docs/adr/ADR-002-multi-tenant-architecture.md. A SessionProvider isn't
 * needed as a separate context: useSession() (hooks/useSession.ts) reads
 * directly from the mock staff fixture for now and will read from a real
 * Wix-Members session once auth exists, without requiring its own provider.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>{children}</OrganizationProvider>
    </QueryClientProvider>
  );
}
