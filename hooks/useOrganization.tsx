'use client';

import { createContext, useContext } from 'react';
import type { OrganizationContext as OrganizationContextType } from '@/types/organization';
import type { DataAdapterMode } from '@/lib/env';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/fixtures';

/**
 * Supplies OrganizationContext app-wide (docs/adr/ADR-002-multi-tenant-architecture.md).
 *
 * Phase 13: `organizationId` is now an explicit prop, supplied by
 * app/(portal)/layout.tsx from a server-resolved AuthorizationContext (see
 * lib/auth/authorize.ts) — never a browser-supplied value, never
 * hardcoded. The default parameter below exists only so this component
 * still works with no prop at all (the root app/providers.tsx mounts one
 * with no organizationId, for routes like /login that have no session to
 * resolve one from — nothing on those routes calls useOrganization()
 * anyway). No existing service call site changes: every function still
 * receives the exact same `{ organizationId: string }` shape it always
 * has.
 *
 * Phase 15C: also carries `dataAdapterMode`, server-resolved in
 * app/(portal)/layout.tsx via lib/env.ts's getDataAdapterMode() and passed
 * down as read-only configuration — the same trusted-server-value pattern
 * `organizationId` already established, not a new mechanism. This exists
 * specifically because `casesService.ts` uniquely has client-side write
 * functions (create/update) that share state with its reads in mock mode;
 * see docs/adr/ADR-013-wix-case-read-integration.md for the full
 * reasoning. `DataAdapterMode` is imported as a type only — erased at
 * build time, so no runtime code from lib/env.ts (server-only) ever
 * reaches this Client Component's bundle.
 */
type OrganizationProviderValue = OrganizationContextType & { dataAdapterMode: DataAdapterMode };

const Context = createContext<OrganizationProviderValue>({
  organizationId: DEFAULT_ORGANIZATION_ID,
  dataAdapterMode: 'mock',
});

export function OrganizationProvider({
  organizationId = DEFAULT_ORGANIZATION_ID,
  dataAdapterMode = 'mock',
  children,
}: {
  organizationId?: string;
  dataAdapterMode?: DataAdapterMode;
  children: React.ReactNode;
}) {
  return <Context.Provider value={{ organizationId, dataAdapterMode }}>{children}</Context.Provider>;
}

/**
 * The only sanctioned way to obtain an organizationId — no component, hook,
 * or service caller is ever allowed to hardcode one. Also the sanctioned
 * way to read the server-resolved dataAdapterMode (Phase 15C) — existing
 * callers that only destructure `{ organizationId }` are unaffected; the
 * extra field is additive, not a breaking change to OrganizationContext
 * itself (still `{ organizationId: string }` in types/organization.ts).
 */
export function useOrganization(): OrganizationProviderValue {
  return useContext(Context);
}
