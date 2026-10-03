import { getAuthAdapterMode } from '@/lib/env';
import { SettingsShell } from '@/components/settings/SettingsShell';

/**
 * SOLIS Tasks/Calendar/Settings phase, §3.2 — resolves `authAdapterMode`
 * server-side (the same trusted-server-value pattern
 * `app/(portal)/settings/page.tsx` already used for `SettingsHub`) and
 * wraps every page under `/settings` in the shared nav/header shell.
 * `/unmatched-forms` is outside `/settings` and doesn't get this layout.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const authAdapterMode = getAuthAdapterMode();
  return <SettingsShell authAdapterMode={authAdapterMode}>{children}</SettingsShell>;
}
