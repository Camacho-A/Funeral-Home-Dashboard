'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AuthAdapterMode } from '@/lib/env';
import { ImportHistoricalCaseModal } from '@/components/modals/ImportHistoricalCaseModal';
import { useSettingsAreas, type AdminArea } from '@/app/(portal)/settings/settingsAreas';

/**
 * SOLIS Tasks/Calendar/Settings phase, §3.2 — the persistent left nav
 * shown on every settings page (and, below 860px, the hub's own full-width
 * list — see `.sx-settings-hub .sx-settings-nav` in solis-workspace.css).
 * Area data/visibility comes from the same `useSettingsAreas` hook
 * `SettingsHub` uses — single source of truth, unchanged rules. Keeps its
 * own `isImportModalOpen` state and `<ImportHistoricalCaseModal>` instance,
 * independent of SettingsHub's (see that hook's own comment for why).
 */
export function SettingsNav({ authAdapterMode }: { authAdapterMode: AuthAdapterMode }) {
  const pathname = usePathname();
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const { administration, securityAndRoles } = useSettingsAreas(authAdapterMode, () => setImportModalOpen(true));

  function renderArea(area: AdminArea) {
    if (!area.visible) return null;
    if ('href' in area) {
      return (
        <Link key={area.key} href={area.href} className="sx-settings-link" aria-current={pathname === area.href ? 'page' : undefined}>
          {area.label}
        </Link>
      );
    }
    return (
      <button key={area.key} type="button" className="sx-settings-link" onClick={area.onClick}>
        {area.label}
      </button>
    );
  }

  const visibleAdministration = administration.filter((a) => a.visible);
  const visibleSecurityAndRoles = securityAndRoles.filter((a) => a.visible);

  return (
    <nav className="sx-settings-nav" aria-label="Settings">
      {visibleAdministration.length > 0 && (
        <>
          <div className="sx-settings-group">Administration</div>
          {visibleAdministration.map(renderArea)}
        </>
      )}
      {visibleSecurityAndRoles.length > 0 && (
        <>
          <div className="sx-settings-group">Security &amp; Roles</div>
          {visibleSecurityAndRoles.map(renderArea)}
        </>
      )}
      <ImportHistoricalCaseModal open={isImportModalOpen} onClose={() => setImportModalOpen(false)} />
    </nav>
  );
}
