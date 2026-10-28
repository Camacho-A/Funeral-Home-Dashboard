'use client';

import { Suspense } from 'react';
import { CrematorySettingsPanel } from '@/components/settings/CrematorySettingsPanel';

/**
 * Send to Crematory (2026-10). "Settings > Crematory" — administrators only
 * (the API checks `organization.manage`), and only for an organization with
 * Send to Crematory (the settings nav hides it otherwise).
 */
export default function CrematorySettingsPage() {
  return (
    <div>
      <h1>Crematory</h1>
      <Suspense>
        <CrematorySettingsPanel />
      </Suspense>
    </div>
  );
}
