import { CaseNumberingPanel } from '@/components/settings/CaseNumberingPanel';

/**
 * Manors go-live case-number cutover (2026-09). "Settings > Case
 * Numbering" — not identity-mode-gated, matching
 * `app/(portal)/settings/resources/page.tsx`'s own precedent: this
 * page's data layer authorizes via `requireAuthorizedOrganization` +
 * `organization.manage` (RBAC), which works identically under every
 * `AUTH_ADAPTER`, not `requireIdentitySession`.
 */
export default function CaseNumberingSettingsPage() {
  return (
    <div>
      <h1>Case Numbering</h1>
      <CaseNumberingPanel />
    </div>
  );
}
