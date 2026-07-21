'use client';

import { createContext, useContext } from 'react';
import type { OrganizationContext as OrganizationContextType } from '@/types/organization';
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
 */
const Context = createContext<OrganizationContextType>({ organizationId: DEFAULT_ORGANIZATION_ID });

export function OrganizationProvider({
  organizationId = DEFAULT_ORGANIZATION_ID,
  children,
}: {
  organizationId?: string;
  children: React.ReactNode;
}) {
  return <Context.Provider value={{ organizationId }}>{children}</Context.Provider>;
}

/**
 * The only sanctioned way to obtain an organizationId — no component, hook,
 * or service caller is ever allowed to hardcode one.
 */
export function useOrganization(): OrganizationContextType {
  return useContext(Context);
}
