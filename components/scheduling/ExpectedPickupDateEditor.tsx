'use client';

import { useState } from 'react';
import { PickupDateDialog } from '@/components/case/CremainsPickupSection';
import { useUpdateExpectedPickupDate } from '@/hooks/useCremainsPickup';
import { CremainsPickupError } from '@/lib/cremainsPickupClient';

/**
 * Editable Expected Pickup Date from the calendar (2026-10).
 *
 * The calendar's pickup details only showed the date, so changing it meant
 * opening the case and finding the Schedule tab. This edits the same single
 * case-scoped pickup through the same endpoint and the same dialog the
 * case page uses, so the off-schedule reason rule and the server's checks
 * apply unchanged. A received or cancelled pickup is not offered (the
 * server refuses to re-date a finished one).
 */
export function ExpectedPickupDateEditor({
  organizationId,
  caseId,
  expectedDate,
  organizationToday,
}: {
  organizationId: string;
  caseId: string;
  expectedDate: string;
  organizationToday: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresReason, setRequiresReason] = useState(false);
  const updateDate = useUpdateExpectedPickupDate(organizationId, caseId);

  function close() {
    setOpen(false);
    setError(null);
    setRequiresReason(false);
  }

  async function submit(input: { expectedDate: string; reason: string }) {
    setError(null);
    try {
      await updateDate.mutateAsync({ expectedDate: input.expectedDate, reason: input.reason || null });
      close();
    } catch (e) {
      if (e instanceof CremainsPickupError) {
        setRequiresReason(e.requiresReason);
        setError(
          e.status === 401 || e.status === 403
            ? 'You do not have permission to change this pickup.'
            : e.status >= 500
              ? 'The selected date could not be saved. Please try again.'
              : e.message,
        );
        return;
      }
      setError('The selected date could not be saved. Please try again.');
    }
  }

  return (
    <>
      <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setOpen(true)}>
        Edit date
      </button>
      {open && (
        <PickupDateDialog
          mode="edit"
          initialDate={expectedDate}
          organizationId={organizationId}
          organizationToday={organizationToday}
          busy={updateDate.isPending}
          error={error}
          requiresReason={requiresReason}
          onCancel={close}
          onSubmit={submit}
        />
      )}
    </>
  );
}
