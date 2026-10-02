'use client';

import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { isModuleEnabled } from '@/domain/organization/moduleVisibility';
import { AccountingNav } from '@/components/accounting/AccountingNav';
import { ReconciliationPanel } from '@/components/accounting/ReconciliationPanel';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Manors branding/visibility follow-up (2026-10). Reconciliation is
 * hidden from the nav for an organization that hasn't enabled the
 * `reconciliation` module (`AccountingNav.tsx`) — this page-level check
 * is the second half: a Manors staff member who navigates here directly
 * (bookmark, typed URL) sees the same "not enabled" message instead of
 * the real panel, matching the module's own underlying API routes
 * (`app/api/accounting/banking/reconciliations/route.ts` and siblings),
 * which independently 403 regardless of what this page renders. Nothing
 * deleted — an organization that enables the module sees the real panel
 * immediately, no code change needed.
 */
export default function ReconciliationPage() {
  const { data: organization, isPending } = useOrganizationRecord();

  if (isPending) {
    return (
      <div>
        <AccountingNav />
        <p>Loading…</p>
      </div>
    );
  }

  if (!isModuleEnabled(organization, 'reconciliation')) {
    return (
      <div>
        <AccountingNav />
        <EmptyState message="Reconciliation is not enabled for this organization." />
      </div>
    );
  }

  return (
    <div>
      <AccountingNav />
      <ReconciliationPanel />
    </div>
  );
}
