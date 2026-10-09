'use client';

import { useState } from 'react';
import type { Appointment } from '@/types/appointment';
import type { Case } from '@/types/case';
import { organizationLocalDate, weekdayOf, WEEKDAY_LABEL } from '@/domain/scheduling/cremainsPickupSchedule';
import { resolveCremainsPickupSettingsById } from '@/domain/organization/cremainsPickupCapability';
import { writeChecklistValue } from '@/domain/workflow/checklistItemKey';
import {
  PICKUP_STATUS_LABEL,
  expectedDateOf,
  isExpectedCremainsPickup,
  isManuallyDecided,
  resolvePickupStatus,
  type CremainsPickupStatus,
} from '@/domain/scheduling/cremainsPickupPresentation';
import { useCreateExpectedPickup, useUpdateExpectedPickupDate } from '@/hooks/useCremainsPickup';
import { useConfirmAppointment } from '@/hooks/useAppointments';
import { useCaseMutations } from '@/hooks/useCaseMutations';
import { CremainsPickupError } from '@/lib/cremainsPickupClient';

/**
 * Expected Cremains Pickup — the Case Detail section (2026-10).
 *
 * A dedicated, always-visible section so staff can manage a pickup without
 * going through the generic "Schedule Appointment" flow — including the
 * empty state, which is the case that previously offered no cremains
 * action at all.
 *
 * ONE RECORD, ONE PLACE. Everything here operates on the single
 * deterministic case-scoped appointment the automatic scheduler also uses,
 * so a manual entry and an automatic one can never become competing
 * records. The Schedule tab excludes that appointment from its generic
 * Upcoming/Completed lists precisely so it is never presented twice.
 *
 * Shows no time of day anywhere: a pickup is a calendar date, and SOLIS
 * must never display an invented pickup time.
 */

function statusClass(status: CremainsPickupStatus): string {
  if (status === 'received') return 'sx-status-ok';
  if (status === 'overdue') return 'sx-status-bad';
  if (status === 'confirmed') return 'sx-status-info';
  return 'sx-status-plain';
}

/** Formats `YYYY-MM-DD` as a calendar date, with no timezone conversion —
    the string is already the organization's own local date. */
export function formatPickupDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The paperwork date the automation recorded when it scheduled this.
    Returns null for a staff-entered pickup, which asserts no paperwork
    date at all — never a guessed one. */
export function paperworkDateFromNotes(notes: string | null): string | null {
  if (!notes) return null;
  if (!/COMPLETED CREMATORY PAPERWORK/i.test(notes)) return null;
  const match = /(\d{4}-\d{2}-\d{2})/.exec(notes);
  return match ? match[1] : null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="sx-field-label">{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </div>
  );
}

/** Date entry shared by "Add Expected Pickup" and "Edit Date". */
function PickupDateDialog({
  title,
  confirmLabel,
  initialDate,
  organizationId,
  organizationToday,
  busy,
  error,
  requiresReason,
  onCancel,
  onSubmit,
}: {
  title: string;
  confirmLabel: string;
  initialDate: string;
  organizationId: string;
  organizationToday: string;
  busy: boolean;
  error: string | null;
  requiresReason: boolean;
  onCancel: () => void;
  onSubmit: (input: { expectedDate: string; reason: string; notes: string }) => void;
}) {
  const [expectedDate, setExpectedDate] = useState(initialDate);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const settings = resolveCremainsPickupSettingsById(organizationId);
  const allowedLabels = settings.allowedPickupWeekdays.map((d) => WEEKDAY_LABEL[d]).join(' and ');
  const weekday = weekdayOf(expectedDate);
  const offSchedule = weekday !== null && !settings.allowedPickupWeekdays.includes(weekday);
  const inPast = Boolean(expectedDate) && Boolean(organizationToday) && expectedDate < organizationToday;

  return (
    <div className="sx-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sx-modal" style={{ maxWidth: 460 }}>
        <h3 className="sx-modal-title">{title}</h3>

        <label className="sx-filter" style={{ display: 'block', marginTop: 12 }}>
          <span className="sx-field-label">Expected pickup date</span>
          <input
            type="date"
            className="sx-input"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            aria-label="Expected pickup date"
          />
        </label>
        <p className="sx-hint" style={{ marginTop: 6 }}>
          Pickup days are {allowedLabels}.
        </p>

        {offSchedule && weekday !== null && (
          <p className="sx-hint" role="status" style={{ marginTop: 6 }}>
            {formatPickupDate(expectedDate)} is a {WEEKDAY_LABEL[weekday]}, which is not a pickup day. Give a reason to
            use it anyway — the date will be saved exactly as entered.
          </p>
        )}
        {inPast && (
          <p className="sx-hint" role="status" style={{ marginTop: 6 }}>
            This date is in the past. It will be saved as entered, not moved to a later day.
          </p>
        )}

        {(offSchedule || requiresReason) && (
          <label className="sx-filter" style={{ display: 'block', marginTop: 10 }}>
            <span className="sx-field-label">Reason</span>
            <input
              className="sx-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. crematory confirmed an earlier date"
              aria-label="Reason"
            />
          </label>
        )}

        <label className="sx-filter" style={{ display: 'block', marginTop: 10 }}>
          <span className="sx-field-label">Notes (optional)</span>
          <input className="sx-input" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
        </label>

        {error && (
          <p className="sx-error-state" role="alert" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}

        <div className="sx-modal-actions" style={{ marginTop: 14 }}>
          <button type="button" className="sx-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="sx-btn sx-btn-primary"
            disabled={busy || !expectedDate || ((offSchedule || requiresReason) && !reason.trim())}
            onClick={() => onSubmit({ expectedDate, reason, notes })}
          >
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function MarkReceivedDialog({
  expectedDate,
  organizationToday,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  expectedDate: string;
  organizationToday: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: { receivedOn: string; note: string }) => void;
}) {
  const [receivedOn, setReceivedOn] = useState(organizationToday || expectedDate);
  const [note, setNote] = useState('');

  return (
    <div className="sx-modal-backdrop" role="dialog" aria-modal="true" aria-label="Mark cremains received">
      <div className="sx-modal" style={{ maxWidth: 460 }}>
        <h3 className="sx-modal-title">Mark Cremains Received</h3>
        <p style={{ marginTop: 8 }}>
          Confirm the cremains for this case are physically in your possession. This does not complete the case.
        </p>

        <label className="sx-filter" style={{ display: 'block', marginTop: 12 }}>
          <span className="sx-field-label">Date received</span>
          <input
            type="date"
            className="sx-input"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            aria-label="Date received"
          />
        </label>

        <label className="sx-filter" style={{ display: 'block', marginTop: 10 }}>
          <span className="sx-field-label">Note (optional)</span>
          <input className="sx-input" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Receipt note" />
        </label>

        {error && (
          <p className="sx-error-state" role="alert" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}

        <div className="sx-modal-actions" style={{ marginTop: 14 }}>
          <button type="button" className="sx-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="sx-btn sx-btn-primary"
            disabled={busy || !receivedOn}
            onClick={() => onSubmit({ receivedOn, note })}
          >
            {busy ? 'Saving…' : 'Mark Received'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CremainsPickupSection({
  caseId,
  organizationId,
  appointments,
  case_,
  canSchedule,
  organizationTimezone,
}: {
  caseId: string;
  organizationId: string;
  appointments: Appointment[];
  /** Needed only to write the organization's own receipt checklist item. */
  case_: Case | null;
  canSchedule: boolean;
  organizationTimezone: string | undefined;
}) {
  const pickup = appointments.find(isExpectedCremainsPickup) ?? null;

  const [dialog, setDialog] = useState<'add' | 'edit' | 'receive' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresReason, setRequiresReason] = useState(false);

  const createPickup = useCreateExpectedPickup(organizationId, caseId);
  const updateDate = useUpdateExpectedPickupDate(organizationId, caseId);
  const confirmAppointment = useConfirmAppointment(organizationId);
  const caseMutations = useCaseMutations(caseId);

  // "Today" in the ORGANIZATION's timezone — never the viewer's device.
  const timezone = organizationTimezone ?? pickup?.timezone;
  const organizationToday = organizationLocalDate(new Date().toISOString(), timezone) ?? '';

  const expected = pickup ? expectedDateOf(pickup) : null;
  const status = pickup ? resolvePickupStatus(pickup, organizationToday) : null;
  const received = status === 'received';
  const paperworkDate = pickup ? paperworkDateFromNotes(pickup.notes) : null;

  function closeDialog() {
    setDialog(null);
    setError(null);
    setRequiresReason(false);
  }

  function reportError(e: unknown) {
    if (e instanceof CremainsPickupError) {
      setError(e.message);
      setRequiresReason(e.requiresReason);
      return;
    }
    setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
  }

  async function submitDate(input: { expectedDate: string; reason: string; notes: string }) {
    setError(null);
    try {
      if (pickup) {
        await updateDate.mutateAsync({ expectedDate: input.expectedDate, reason: input.reason || null });
      } else {
        await createPickup.mutateAsync({
          expectedDate: input.expectedDate,
          reason: input.reason || null,
          notes: input.notes || null,
        });
      }
      closeDialog();
    } catch (e) {
      reportError(e);
    }
  }

  /**
   * Receipt. The organization's own "Ashes picked up" checklist item is the
   * single source of truth: ticking it is what the server's own sync turns
   * into a completed pickup, so there are never two independent receipt
   * states to reconcile.
   *
   * If staff correct the date, the pickup is re-dated FIRST (while it is
   * still editable) so the completed record carries the day the cremains
   * actually arrived. If that first step fails nothing is marked received;
   * if the second fails the date is simply updated and staff can retry —
   * neither order can leave a conflicting state, and errors are surfaced
   * rather than swallowed.
   */
  async function submitReceipt(input: { receivedOn: string; note: string }) {
    setError(null);
    const settings = resolveCremainsPickupSettingsById(organizationId);
    const item = settings.receiptChecklistItem;
    if (!case_ || item.displayStage < 0) {
      setError('This organization has no cremains receipt task configured, so receipt cannot be recorded here.');
      return;
    }
    try {
      if (pickup && expected && input.receivedOn !== expected) {
        await updateDate.mutateAsync({
          expectedDate: input.receivedOn,
          reason: input.note || 'Actual receipt date',
        });
      }
      caseMutations.updateCaseInfo({
        checklistState: writeChecklistValue(case_.checklistState, item.displayStage, item.index, true),
      });
      closeDialog();
    } catch (e) {
      reportError(e);
    }
  }

  const busy = createPickup.isPending || updateDate.isPending || confirmAppointment.isPending;

  return (
    <section className="sx-card" aria-label="Cremains pickup" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
        <h3 className="sx-card-title" style={{ margin: 0 }}>
          Cremains Pickup
        </h3>
        {status && <span className={`sx-status ${statusClass(status)}`}>{PICKUP_STATUS_LABEL[status]}</span>}
      </div>

      {!pickup && (
        <>
          <p className="sx-hint" style={{ margin: '8px 0 0' }}>
            No expected pickup scheduled.
          </p>
          {canSchedule && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="sx-btn sx-btn-primary" onClick={() => setDialog('add')}>
                Add Expected Pickup
              </button>
            </div>
          )}
        </>
      )}

      {pickup && expected && (
        <>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: '12px 18px',
              margin: '12px 0 0',
            }}
          >
            <Field label={received ? 'Received' : 'Expected pickup'}>
              <strong>{formatPickupDate(expected)}</strong>
            </Field>
            <Field label="Status">{PICKUP_STATUS_LABEL[status!]}</Field>
            <Field label="Paperwork sent">
              {paperworkDate ? formatPickupDate(paperworkDate) : 'Not recorded'}
            </Field>
            <Field label="Actual receipt">{received ? formatPickupDate(expected) : 'Not yet received'}</Field>
            <Field label="Date source">{isManuallyDecided(pickup) ? 'Set by staff' : 'Automatically calculated'}</Field>
          </dl>

          {status === 'overdue' && (
            <p className="sx-hint" role="status" style={{ marginTop: 10 }}>
              The expected date has passed and the cremains have not been marked received.
            </p>
          )}

          {canSchedule && !received && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
              <button type="button" className="sx-btn" onClick={() => setDialog('edit')} disabled={busy}>
                Edit Date
              </button>
              {status !== 'confirmed' && (
                <button
                  type="button"
                  className="sx-btn"
                  disabled={busy}
                  onClick={async () => {
                    setError(null);
                    try {
                      await confirmAppointment.mutateAsync(pickup.id);
                    } catch (e) {
                      reportError(e);
                    }
                  }}
                >
                  Confirm Pickup
                </button>
              )}
              <button type="button" className="sx-btn sx-btn-primary" onClick={() => setDialog('receive')} disabled={busy}>
                Mark Received
              </button>
            </div>
          )}
        </>
      )}

      {error && !dialog && (
        <p className="sx-error-state" role="alert" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}

      {(dialog === 'add' || dialog === 'edit') && (
        <PickupDateDialog
          title={dialog === 'add' ? 'Add Expected Pickup' : 'Edit Expected Date'}
          confirmLabel={dialog === 'add' ? 'Add Expected Pickup' : 'Save Date'}
          initialDate={dialog === 'edit' ? (expected ?? '') : ''}
          organizationId={organizationId}
          organizationToday={organizationToday}
          busy={busy}
          error={error}
          requiresReason={requiresReason}
          onCancel={closeDialog}
          onSubmit={submitDate}
        />
      )}

      {dialog === 'receive' && expected && (
        <MarkReceivedDialog
          expectedDate={expected}
          organizationToday={organizationToday}
          busy={busy || caseMutations.isPending}
          error={error}
          onCancel={closeDialog}
          onSubmit={submitReceipt}
        />
      )}
    </section>
  );
}
