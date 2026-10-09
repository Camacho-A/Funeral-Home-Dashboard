'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import styles from './CremainsPickupDialog.module.css';
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

/** "Tuesday and Friday" / "Tuesday, Thursday and Friday" — derived from
    the organization's own configured days, never hardcoded wording. */
function formatWeekdayList(labels: string[]): string {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function statusClass(status: CremainsPickupStatus): string {
  if (status === 'received') return 'sx-status-ok';
  if (status === 'overdue') return 'sx-status-bad';
  if (status === 'confirmed') return 'sx-status-info';
  return 'sx-status-plain';
}

/** Formats `YYYY-MM-DD` as a calendar date, with no timezone conversion —
    the string is already the organization's own local date. */
/** Same calendar date without the weekday — used where the weekday is
    already named in the surrounding sentence. */
export function formatPickupDateShort(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

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

/**
 * Date entry, shared by "Add Expected Pickup" and "Edit Expected Date" so
 * the two can never drift apart in layout, validation or wording.
 *
 * Built on the shared `Modal` primitive, which already provides the dialog
 * semantics this needs: Escape to close, focus moved into the panel and
 * trapped there, and focus returned to the trigger on close. The
 * header/body/footer structure comes from the existing `.sx-modal-*`
 * system — using it is what fixes the previously cramped layout, and means
 * this dialog inherits any future change to that system.
 */
function PickupDateDialog({
  mode,
  initialDate,
  organizationId,
  organizationToday,
  busy,
  error,
  requiresReason,
  onCancel,
  onSubmit,
}: {
  mode: 'add' | 'edit';
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
  const allowedLabels = formatWeekdayList(settings.allowedPickupWeekdays.map((d) => WEEKDAY_LABEL[d]));
  const weekday = weekdayOf(expectedDate);
  const offSchedule = weekday !== null && !settings.allowedPickupWeekdays.includes(weekday);
  const inPast = Boolean(expectedDate) && Boolean(organizationToday) && expectedDate < organizationToday;
  const needsReason = offSchedule || requiresReason;
  const canSubmit = Boolean(expectedDate) && (!needsReason || Boolean(reason.trim())) && !busy;

  const title = mode === 'add' ? 'Add Expected Cremains Pickup' : 'Edit Expected Pickup Date';
  const confirmLabel = mode === 'add' ? 'Add Expected Pickup' : 'Save Date';

  return (
    <Modal open onClose={busy ? () => undefined : onCancel} title={title} size="lg">
      <div className={`sx-modal-header ${styles.header}`}>
        <span className={styles.headerIcon} aria-hidden="true">
          🗓
        </span>
        <div className={styles.headerText}>
          <h2 className="sx-modal-title">{title}</h2>
          <p className={styles.description}>
            Set the date the cremains are expected to be ready for pickup from the crematory.
          </p>
        </div>
        <button type="button" className="sx-icon-btn" aria-label="Close" onClick={onCancel} disabled={busy}>
          ×
        </button>
      </div>

      <div className={`sx-modal-body ${styles.body}`}>
        <div className={styles.infoPanel}>
          <span className={styles.infoTitle}>Pickup days</span>
          <span className={styles.infoText}>
            {allowedLabels
              ? `Cremains are typically available for pickup on ${allowedLabels}.`
              : 'This organization has no configured pickup days.'}
          </span>
        </div>

        <div className="sx-field">
          <label className="sx-label sx-label-required" htmlFor="cremains-expected-date">
            Expected Pickup Date
          </label>
          <input
            id="cremains-expected-date"
            type="date"
            className={`sx-input ${styles.input}`}
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            aria-describedby="cremains-expected-date-help"
            required
          />
          <span id="cremains-expected-date-help" className={styles.helper}>
            Select the expected date the cremains will be available.
          </span>
        </div>

        {offSchedule && weekday !== null && (
          <p className={`${styles.notice} ${styles.noticeWarning}`} role="status">
            <span className={styles.noticeIcon} aria-hidden="true">
              !
            </span>
            <span>
              {formatPickupDateShort(expectedDate)} is a {WEEKDAY_LABEL[weekday]}, which falls outside your usual
              pickup schedule. Please provide a reason.
            </span>
          </p>
        )}

        {inPast && (
          <p className={`${styles.notice} ${styles.noticeWarning}`} role="status">
            <span className={styles.noticeIcon} aria-hidden="true">
              !
            </span>
            <span>This date is in the past. It will be saved as entered.</span>
          </p>
        )}

        {needsReason && (
          <div className="sx-field">
            <label className="sx-label sx-label-required" htmlFor="cremains-reason">
              Reason
            </label>
            <input
              id="cremains-reason"
              className={`sx-input ${styles.input}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. the crematory confirmed an earlier date"
            />
          </div>
        )}

        {mode === 'add' && (
          <div className="sx-field">
            <label className="sx-label" htmlFor="cremains-notes">
              Notes (optional)
            </label>
            <textarea
              id="cremains-notes"
              className={styles.textarea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this pickup..."
              rows={4}
            />
          </div>
        )}

        {error && (
          <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
            <span className={styles.noticeIcon} aria-hidden="true">
              !
            </span>
            <span>{error}</span>
          </p>
        )}
      </div>

      <div className="sx-modal-footer">
        <button type="button" className="sx-btn sx-btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="sx-btn sx-btn-primary"
          disabled={!canSubmit}
          onClick={() => onSubmit({ expectedDate, reason, notes })}
        >
          {busy ? 'Saving…' : confirmLabel}
        </button>
      </div>
    </Modal>
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
    <Modal open onClose={busy ? () => undefined : onCancel} title="Mark Cremains Received" size="lg">
      <div className={`sx-modal-header ${styles.header}`}>
        <span className={styles.headerIcon} aria-hidden="true">
          ✓
        </span>
        <div className={styles.headerText}>
          <h2 className="sx-modal-title">Mark Cremains Received</h2>
          <p className={styles.description}>
            Confirm the cremains for this case are physically in your possession. This does not complete the case.
          </p>
        </div>
        <button type="button" className="sx-icon-btn" aria-label="Close" onClick={onCancel} disabled={busy}>
          ×
        </button>
      </div>

      <div className={`sx-modal-body ${styles.body}`}>
        <div className="sx-field">
          <label className="sx-label sx-label-required" htmlFor="cremains-received-on">
            Date Received
          </label>
          <input
            id="cremains-received-on"
            type="date"
            className={`sx-input ${styles.input}`}
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            aria-describedby="cremains-received-on-help"
            required
          />
          <span id="cremains-received-on-help" className={styles.helper}>
            Defaults to today. Correct it if the cremains arrived on a different day.
          </span>
        </div>

        <div className="sx-field">
          <label className="sx-label" htmlFor="cremains-receipt-note">
            Note (optional)
          </label>
          <textarea
            id="cremains-receipt-note"
            className={styles.textarea}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add any notes about this receipt..."
            rows={3}
          />
        </div>

        {error && (
          <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
            <span className={styles.noticeIcon} aria-hidden="true">
              !
            </span>
            <span>{error}</span>
          </p>
        )}
      </div>

      <div className="sx-modal-footer">
        <button type="button" className="sx-btn sx-btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="sx-btn sx-btn-primary" disabled={busy || !receivedOn} onClick={() => onSubmit({ receivedOn, note })}>
          {busy ? 'Saving…' : 'Mark Received'}
        </button>
      </div>
    </Modal>
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

  /**
   * Turns a failure into something a funeral director can act on.
   *
   * The server's own message is preferred when it is a real, specific
   * explanation (a duplicate, a date it refused). Anything else — a 500, a
   * dropped connection, an unexpected shape — becomes a plain retry
   * message rather than leaking backend detail, which is all staff saw
   * before: a generic "Could not save the expected pickup."
   */
  function reportError(e: unknown) {
    if (e instanceof CremainsPickupError) {
      setRequiresReason(e.requiresReason);
      if (e.status === 401 || e.status === 403) {
        setError('You do not have permission to schedule this pickup.');
        return;
      }
      if (e.status === 409) {
        setError('A cremains pickup already exists for this case. Edit the existing one instead.');
        return;
      }
      if (e.status === 404) {
        setError('This case could not be found. Refresh the page and try again.');
        return;
      }
      if (e.status >= 500) {
        setError('The selected date could not be saved. Please try again.');
        return;
      }
      setError(e.message);
      return;
    }
    setError('The selected date could not be saved. Please try again.');
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
          mode={dialog}
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
