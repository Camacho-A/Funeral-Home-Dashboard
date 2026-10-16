import { Button } from '@/components/ui/Button';
import { CASE_REVISION_CONFLICT_MESSAGE } from '@/domain/cases/caseRevisionConflict';

/**
 * Case concurrency (2026-10). Shown on the case page when an edit was
 * refused because someone else changed the case after this page loaded it
 * (PATCH /api/cases/[caseId] answered 409). Nothing was saved, and the
 * banner says so plainly — staff must never be left believing an edit
 * stuck when it didn't.
 *
 *  - Refresh loads the latest case and drops the refused edit, so staff can
 *    see what changed before deciding anything.
 *  - Retry applies the same edit on top of the latest case — an explicit,
 *    informed choice to overwrite, never an automatic one.
 *
 * Same wording and controls as Gus SOLIS's banner.
 */
export function CaseEditConflictBanner({ onRefresh, onRetry }: { onRefresh: () => void; onRetry: () => void }) {
  return (
    <div className="sx-form-banner sx-form-banner-error" role="alert" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ flex: '1 1 240px' }}>{CASE_REVISION_CONFLICT_MESSAGE} Your last change was not saved.</span>
      <span style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" onClick={onRefresh}>
          Refresh
        </Button>
        <Button variant="ghost" onClick={onRetry}>
          Retry my change
        </Button>
      </span>
    </div>
  );
}
