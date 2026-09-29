import { OrganizationProfilePanel } from '@/components/settings/OrganizationProfilePanel';

/**
 * Settings → Organization Profile (2026-09). Not identity-mode-gated,
 * matching `app/(portal)/settings/case-numbering/page.tsx`'s own
 * precedent: this page's data layer authorizes via
 * `requireAuthorizedOrganization` + `organization.manage` (RBAC), which
 * works identically under every `AUTH_ADAPTER`.
 */
export default function OrganizationProfileSettingsPage() {
  return (
    <div>
      <h1>Organization Profile</h1>
      <OrganizationProfilePanel />
    </div>
  );
}
