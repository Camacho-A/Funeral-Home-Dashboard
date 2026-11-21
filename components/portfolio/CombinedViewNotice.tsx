'use client';

import { usePathname } from 'next/navigation';
import { usePortfolio } from '@/hooks/usePortfolio';

/** Pages that combine every authorized organization. */
export const COMBINED_PAGES: readonly string[] = ['/dashboard', '/cases'];

/**
 * Unified portal (Phase 5N, 2026-11). In the combined view, every page
 * other than the combined Dashboard and case search still works on ONE
 * organization — the working organization. This says which, so nobody
 * mistakes a single-organization page (Tasks, Settings, a case…) for a
 * combined one, or wonders where a change will go.
 */
export function CombinedViewNotice() {
  const pathname = usePathname();
  const { combined, organizations, workingOrganizationId } = usePortfolio();
  if (!combined || COMBINED_PAGES.includes(pathname)) return null;
  const name = organizations.find((o) => o.organizationId === workingOrganizationId)?.displayName ?? workingOrganizationId;
  return (
    <p className="sx-form-banner" role="note" data-testid="combined-view-notice" style={{ margin: '0 0 12px' }}>
      This page shows <strong>{name}</strong> only, and any change here is made in {name}.
    </p>
  );
}
