'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMyMemberships } from '@/lib/identityAuthClient';
import { useOrganization } from './useOrganization';

/**
 * Unified portal (Phase 5N, 2026-11). Which organizations the signed-in
 * person may work in — always the SERVER's answer (/api/auth/memberships:
 * active memberships, filtered to this deployment) — and whether they are
 * looking at one organization or "All authorized organizations".
 *
 * "All" is a VIEWING mode only. It is not an organization and is never sent
 * to the server: combined pages ask the server about each authorized
 * organization separately (each request re-checked against that
 * membership), and every write still runs in one specific organization —
 * the session's working organization, chosen explicitly. The choice is
 * remembered per browser (a convenience; it grants nothing).
 */
export type PortfolioOrganization = { organizationId: string; displayName: string; role: string; isCurrent: boolean };

const STORAGE_KEY = 'solis.portfolio.combinedView';
type ScopeState = { enabled: boolean; combined: boolean; setCombined: (combined: boolean) => void };
const ScopeContext = createContext<ScopeState>({ enabled: false, combined: false, setCombined: () => undefined });

export function PortfolioScopeProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [combined, setCombinedState] = useState(false);
  useEffect(() => {
    try {
      setCombinedState(window.localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      // Storage unavailable: start on the single organization.
    }
  }, []);
  const setCombined = useCallback((value: boolean) => {
    setCombinedState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    } catch {
      // Not remembered; still applied for this page.
    }
  }, []);
  const value = useMemo(() => ({ enabled, combined, setCombined }), [enabled, combined, setCombined]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function usePortfolio() {
  const { enabled, combined, setCombined } = useContext(ScopeContext);
  const { organizationId } = useOrganization();
  const memberships = useQuery({ queryKey: ['myMemberships'], queryFn: fetchMyMemberships, enabled });
  const organizations: PortfolioOrganization[] = memberships.data ?? [];
  const isMultiOrganization = organizations.length > 1;
  return {
    organizations,
    isMultiOrganization,
    /** True only when the person belongs to 2+ organizations and chose "All". */
    combined: isMultiOrganization && combined,
    setCombined,
    workingOrganizationId: organizationId,
    isLoading: memberships.isLoading,
  };
}
