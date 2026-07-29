import { redirect } from 'next/navigation';
import { getAuthAdapterMode } from '@/lib/env';
import { AuditCenterPanel } from '@/components/settings/AuditCenterPanel';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). "Settings > Audit."
 * Only meaningful for `AUTH_ADAPTER=identity` — the routes this page's
 * data layer calls (`/api/activity`, `/api/activity/export`) are gated by
 * `requireIdentitySession`, exactly like every other identity-mode-only
 * settings page. Redirects back to the main Settings page instead of
 * rendering that, matching `app/(portal)/settings/team/page.tsx`'s own
 * precedent.
 */
export default async function AuditCenterPage() {
  if (getAuthAdapterMode() !== 'identity') {
    redirect('/settings');
  }

  return (
    <div>
      <h1>Audit Log</h1>
      <AuditCenterPanel />
    </div>
  );
}
