import { redirect } from 'next/navigation';
import { getAuthAdapterMode } from '@/lib/env';
import { TeamManagementPanel } from '@/components/settings/TeamManagementPanel';

/**
 * Phase 23 (Team Management). "Settings > Team." Only meaningful for
 * `AUTH_ADAPTER=identity` — the routes this page's data layer calls
 * (`/api/auth/invitations`, `/api/rbac/*`) are gated by
 * `requireIdentitySession` exactly like every other identity-mode-only
 * settings page, so a mock/wix session would see every action 401
 * immediately. Redirects back to the main Settings page instead of
 * rendering that, matching `app/(portal)/settings/roles/page.tsx`'s own
 * precedent.
 */
export default async function TeamManagementPage() {
  if (getAuthAdapterMode() !== 'identity') {
    redirect('/settings');
  }

  return (
    <div>
      <h1>Team</h1>
      <TeamManagementPanel />
    </div>
  );
}
