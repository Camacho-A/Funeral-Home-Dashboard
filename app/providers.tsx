'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * App-wide provider composition (Frontend Engineering Plan, Phase 0).
 *
 * QueryClientProvider is fully wired here. OrganizationProvider/SessionProvider
 * are added inside this same component in Phase 4, once types/organization.ts
 * and the provider implementations exist (see docs/adr/ADR-002-multi-tenant-architecture.md
 * and docs/adr/ADR-005-tanstack-query.md) — this is the single composition point,
 * so no other file needs to change when that happens.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
