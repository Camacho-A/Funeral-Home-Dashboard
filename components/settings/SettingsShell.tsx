'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

/**
 * SOLIS Tasks/Calendar/Settings phase, §3.3 — wraps every page under
 * `/settings` (via `app/(portal)/settings/layout.tsx`). Owns the one
 * "Settings" page title; sub-pages keep only their own `.sx-settings-head`
 * content (§3.5) — their previous per-page `<h1>` that duplicated
 * "Settings" is gone.
 *
 * Addendum 2 follow-up (2026-10): the persistent left nav (`SettingsNav`)
 * is gone — the main app Sidebar now shows this exact same list whenever
 * the viewer is on any Settings page (Addendum 2, item #6), so an
 * in-page copy was pure duplication. `authAdapterMode` was only ever
 * threaded through to `SettingsNav`; no longer needed here, so it's no
 * longer a prop.
 */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHub = pathname === '/settings';

  return (
    <div>
      <h1 className="sx-page-title" style={{ marginBottom: 24 }}>
        Settings
      </h1>
      <div className={isHub ? 'sx-settings sx-settings-hub' : 'sx-settings'}>
        <div className="sx-settings-main">
          {!isHub && (
            <Link href="/settings" className="sx-back sx-settings-back">
              ← Settings
            </Link>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
