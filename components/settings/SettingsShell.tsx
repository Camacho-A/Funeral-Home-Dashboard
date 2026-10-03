'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { AuthAdapterMode } from '@/lib/env';
import { SettingsNav } from './SettingsNav';

/**
 * SOLIS Tasks/Calendar/Settings phase, §3.3 — wraps every page under
 * `/settings` (via `app/(portal)/settings/layout.tsx`). Owns the one
 * "Settings" page title and the persistent left nav; sub-pages keep only
 * their own `.sx-settings-head` content (§3.5) — their previous per-page
 * `<h1>` that duplicated "Settings" is gone.
 */
export function SettingsShell({ authAdapterMode, children }: { authAdapterMode: AuthAdapterMode; children: React.ReactNode }) {
  const pathname = usePathname();
  const isHub = pathname === '/settings';

  return (
    <div>
      <h1 className="sx-page-title" style={{ marginBottom: 24 }}>
        Settings
      </h1>
      <div className={isHub ? 'sx-settings sx-settings-hub' : 'sx-settings'}>
        <SettingsNav authAdapterMode={authAdapterMode} />
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
