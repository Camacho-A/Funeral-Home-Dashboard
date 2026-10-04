import { SettingsShell } from '@/components/settings/SettingsShell';
import { UnmatchedFormsPanel } from '@/components/externalForms/UnmatchedFormsPanel';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). NOT a
 * general intake queue — never creates a case. See
 * components/externalForms/UnmatchedFormsPanel.tsx.
 *
 * Addendum 2, item #4 (2026-10): wrapped in the same `SettingsShell` every
 * `/settings/*` page uses (see `app/(portal)/settings/layout.tsx`) so the
 * Settings menu stays visible here too — this route lives outside
 * `/settings` (unchanged; it's reached from elsewhere besides Settings)
 * and the page's own content below is unchanged, just no longer
 * unwrapped. The main app Sidebar's own `pathname === area.href` check
 * (Addendum 2, item #6) already highlights Unmatched Forms as selected
 * once this page's own pathname is `/unmatched-forms` — no separate
 * "selected" logic needed here.
 *
 * Addendum 2 follow-up (2026-10): no longer resolves/passes
 * `authAdapterMode` — `SettingsShell` no longer takes it, since its
 * only use was threading through to the now-removed `SettingsNav`.
 */
export default function UnmatchedFormsPage() {
  return (
    <SettingsShell>
      <div>
        <h1>Unmatched Forms</h1>
        <UnmatchedFormsPanel />
      </div>
    </SettingsShell>
  );
}
