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

  // UI refresh (2026-11): the hub has the page header once; a Settings page
  // has a breadcrumb and its own title inside one white card — no repeated
  // "Settings" heading above it.
  return (
    <div>
      {isHub && (
        <div className="sx-page-header">
          <div>
            <h1 className="sx-page-title">Settings</h1>
            <p className="sx-page-desc">Configure your organization, team, workflows and security.</p>
          </div>
        </div>
      )}
      <div className={isHub ? 'sx-settings sx-settings-hub' : 'sx-settings'}>
        <div className="sx-settings-main">
          {isHub ? (
            children
          ) : (
            <>
              <nav className="sx-crumbs" aria-label="Breadcrumb">
                <Link href="/settings" className="sx-settings-back">
                  ← Settings
                </Link>
              </nav>
              <div className="sx-settings-card">{children}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
