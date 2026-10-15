'use client';

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/queryClient';

/**
 * A React Query client that belongs to exactly one signed-in account
 * (performance phase 1, 2026-10).
 *
 * The root client (app/providers.tsx) lives for the whole browser tab, and
 * sign-in, sign-out and organization switches are client-side navigations,
 * so without this, cached data from one account could be shown to the next
 * account using the same tab — for up to `staleTime` now that cached data
 * is reused. The server layouts render this with `key={scope}`, where
 * `scope` is the validated identity + organization (staff) or portal user
 * (family): a different account or organization mounts a brand-new, empty
 * client, and leaving the portal (sign-out) unmounts it entirely. A client
 * is never shared between two scopes.
 */
export function ScopedQueryClientProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
