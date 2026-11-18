'use client';

import { FuneralDirectorCredentialsPanel } from '@/components/settings/FuneralDirectorCredentialsPanel';

/**
 * Settings › Funeral Director Credentials (Gus Phase 5G, 2026-11).
 * Administrators only (the API checks `organization.manage`), and only for
 * an organization that uses them (the settings nav hides it otherwise).
 */
export default function FuneralDirectorCredentialsPage() {
  return (
    <div>
      <h1>Funeral Director Credentials</h1>
      <FuneralDirectorCredentialsPanel />
    </div>
  );
}
