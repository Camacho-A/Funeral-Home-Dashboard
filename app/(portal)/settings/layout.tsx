import { SettingsShell } from '@/components/settings/SettingsShell';

/**
 * SOLIS Tasks/Calendar/Settings phase, §3.2 — wraps every page under
 * `/settings` in the shared header shell. `/unmatched-forms` is outside
 * `/settings` and doesn't get this layout (it wraps itself directly —
 * see that page's own comment).
 *
 * Addendum 2 follow-up (2026-10): no longer resolves `authAdapterMode` —
 * that was only ever needed to thread through to `SettingsShell`'s now-
 * removed `SettingsNav`.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
