'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AuthAdapterMode } from '@/lib/env';
import { ImportHistoricalCaseModal } from '@/components/modals/ImportHistoricalCaseModal';
import { useSettingsAreas, type AdminArea } from './settingsAreas';

/**
 * Item #5 (2026-09, navigation cleanup). "Settings" is now the app's one
 * top-level administrative destination — Team/Security/Roles & Permissions/
 * Case Numbering/Import Existing Jotform no longer have their own
 * top-level Sidebar/TopBar entries (see components/layout/TopBar.tsx's own
 * comment). None of those 4 features were rewritten: every row below is a
 * plain link to (or, for Import Existing Jotform, a trigger for) the exact
 * same pre-existing route/modal/permission check that previously lived in
 * TopBar.tsx — moving *where staff discover them from*, never their
 * implementation, permissions, or business logic.
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.2/§3.4: this component is now
 * just the `/settings` body — the `.sx-page-title` "Settings" heading and
 * the left nav both moved to `SettingsShell`/`SettingsNav` (rendered once,
 * by `app/(portal)/settings/layout.tsx`, around every settings page).
 * Area label/description/visibility logic moved into the shared
 * `useSettingsAreas` hook (`settingsAreas.ts`) — unchanged rules, now also
 * used by `SettingsNav`. This component keeps its own
 * `isImportModalOpen` state and its own `<ImportHistoricalCaseModal>`
 * instance exactly as before (see that hook's own comment for why).
 */
export function SettingsHub({ authAdapterMode }: { authAdapterMode: AuthAdapterMode }) {
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const { administration, securityAndRoles } = useSettingsAreas(authAdapterMode, () => setImportModalOpen(true));

  function renderArea(area: AdminArea) {
    if (!area.visible) return null;
    const content = (
      <>
        <span className="sx-dir-name">{area.label}</span>
        <span className="sx-dir-desc">{area.description}</span>
      </>
    );
    if ('href' in area) {
      return (
        <Link key={area.key} href={area.href} className="sx-dir-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) 16px' }}>
          <span>{content}</span>
          <span className="sx-dir-arrow" aria-hidden="true">
            ›
          </span>
        </Link>
      );
    }
    return (
      <button key={area.key} type="button" className="sx-dir-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) 16px', width: '100%', border: 'none', background: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left' }} onClick={area.onClick}>
        <span>{content}</span>
        <span className="sx-dir-arrow" aria-hidden="true">
          ›
        </span>
      </button>
    );
  }

  const visibleAdministration = administration.filter((a) => a.visible);
  const visibleSecurityAndRoles = securityAndRoles.filter((a) => a.visible);

  return (
    <div>
      <div className="sx-settings-head">
        <h2 className="sx-settings-title">Overview</h2>
        <p className="sx-settings-desc">Configure your organization, team and security.</p>
      </div>

      {visibleAdministration.length > 0 && (
        <section>
          <h3 className="sx-section-title">Administration</h3>
          <div className="sx-dir">{visibleAdministration.map(renderArea)}</div>
        </section>
      )}

      {visibleSecurityAndRoles.length > 0 && (
        <section>
          <h3 className="sx-section-title">
            Security &amp; Roles
          </h3>
          <div className="sx-dir">{visibleSecurityAndRoles.map(renderArea)}</div>
        </section>
      )}

      <ImportHistoricalCaseModal open={isImportModalOpen} onClose={() => setImportModalOpen(false)} />
    </div>
  );
}
