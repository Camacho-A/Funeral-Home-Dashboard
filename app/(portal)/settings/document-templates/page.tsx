import { redirect } from 'next/navigation';
import { getAuthAdapterMode } from '@/lib/env';
import { DocumentTemplateLibraryPanel } from '@/components/settings/DocumentTemplateLibraryPanel';

/**
 * Phase 25 (Document Generation & Template Management). "Settings >
 * Document Templates." Identity-mode only, matching every other
 * identity-mode-only settings page's precedent (`/settings/team`,
 * `/settings/audit`) — the routes this page's data layer calls are
 * gated by `requireIdentitySession`.
 */
export default async function DocumentTemplateLibraryPage() {
  if (getAuthAdapterMode() !== 'identity') {
    redirect('/settings');
  }

  return (
    <div>
      <h1>Document Templates</h1>
      <DocumentTemplateLibraryPanel />
    </div>
  );
}
