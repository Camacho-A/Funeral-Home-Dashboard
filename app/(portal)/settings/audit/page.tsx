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

  // SOLIS Final Phase §6 (2026-10): AuditCenterPanel now renders its own
  // `.sx-page-header` (title "Audit Center" + description + Export CSV
  // action) — see that component's own doc comment for why it moved
  // there instead of living here.
  return <AuditCenterPanel />;
}
