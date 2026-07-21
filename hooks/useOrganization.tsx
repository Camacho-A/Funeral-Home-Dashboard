'use client';

import { createContext, useContext } from 'react';
import type { OrganizationContext as OrganizationContextType } from '@/types/organization';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/fixtures';

/**
 * Supplies OrganizationContext app-wide (docs/adr/ADR-002-multi-tenant-architecture.md).
 * Seeded with the single mock organization for this frontend-only phase;
 * swapped for the real Wix-Members-derived value once auth exists — no
 * caller of useOrganization() changes when that happens.
 */
const Context = createContext<OrganizationContextType>({ organizationId: DEFAULT_ORGANIZATION_ID });

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  return (
    <Context.Provider value={{ organizationId: DEFAULT_ORGANIZATION_ID }}>
      {children}
    </Context.Provider>
  );
}

/**
 * The only sanctioned way to obtain an organizationId — no component, hook,
 * or service caller is ever allowed to hardcode one.
 */
export function useOrganization(): OrganizationContextType {
  return useContext(Context);
}
