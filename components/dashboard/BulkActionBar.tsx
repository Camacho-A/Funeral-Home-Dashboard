import { Button } from '@/components/ui/Button';

/**
 * The "Advance N to next stage" pill — rendered by StageFilteredPanel next
 * to its "back to all cases" link, only when at least one case is selected.
 * Renders nothing itself when there's no selection; the caller decides
 * whether to mount it at all.
 */
export function BulkActionBar({
  selectedCount,
  onAdvance,
}: {
  selectedCount: number;
  onAdvance: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <Button pill onClick={onAdvance}>
      Advance {selectedCount} to next stage
    </Button>
  );
}
