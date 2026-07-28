import { redirect } from 'next/navigation';
import { getAuthAdapterMode } from '@/lib/env';
import { RoleManagementPanel } from '@/components/settings/RoleManagementPanel';

/**
 * Phase 22 (Role-Based Access Control). "Organization Roles Page." Only
 * meaningful for `AUTH_ADAPTER=identity` — the RBAC route surface
 * (`/api/rbac/*`) is gated by `requireIdentitySession` exactly like
 * `/api/auth/*`, so a mock/wix session would see every action on this
 * page 401 immediately. Redirects back to the main Settings page instead
 * of rendering that, matching app/(portal)/settings/security/page.tsx's
 * own precedent.
 */
export default async function OrganizationRolesPage() {
  if (getAuthAdapterMode() !== 'identity') {
    redirect('/settings');
  }

  return (
    <div>
      <h1>Roles &amp; Permissions</h1>
      <RoleManagementPanel />
    </div>
  );
}
