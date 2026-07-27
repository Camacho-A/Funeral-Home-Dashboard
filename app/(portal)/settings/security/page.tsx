import { redirect } from 'next/navigation';
import { getAuthAdapterMode } from '@/lib/env';
import { SecuritySettingsPanel } from '@/components/settings/SecuritySettingsPanel';

/**
 * Phase 21 (Identity, Authentication & Session Management). Only
 * meaningful for `AUTH_ADAPTER=identity` — `'mock'`/`'wix'` sessions have
 * no Membership/IdentitySession rows to manage here at all, so this
 * redirects back to the main Settings page rather than rendering a panel
 * whose every action would 401.
 */
export default async function SecuritySettingsPage() {
  if (getAuthAdapterMode() !== 'identity') {
    redirect('/settings');
  }

  return (
    <div>
      <h1>Security</h1>
      <SecuritySettingsPanel />
    </div>
  );
}
