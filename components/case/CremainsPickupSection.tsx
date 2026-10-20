'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import styles from './CremainsPickupDialog.module.css';
import sectionStyles from './CremainsPickupSection.module.css';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { Appointment } from '@/types/appointment';
import type { Case } from '@/types/case';
import { organizationLocalDate, weekdayOf, WEEKDAY_LABEL } from '@/domain/scheduling/cremainsPickupSchedule';
import { resolveCremainsPickupSettingsById } from '@/domain/organization/cremainsPickupCapability';
import { writeChecklistValue } from '@/domain/workflow/checklistItemKey';
import {
  PICKUP_STATUS_LABEL,
  formatPickupDate,
  formatPickupDateShort,
  paperworkDateFromNotes,
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
import { caseDateToIso, dateReceivedLabel, dateReceivedOf, isoToCaseDate } from '@/domain/cases/cremationDates';

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

/**
 * One fact in the pickup grid: icon and label, the field's own Add/Edit on
 * the same row, then the value. `muted` styles a placeholder ("Not
 * recorded") so it never reads like a real date.
 */
function Field({
  icon,
  label,
  action,
  muted,
  children,
}: {
  icon: IconName;
  label: string;
  action?: React.ReactNode;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={sectionStyles.field}>
      <div className={sectionStyles.fieldHead}>
        <Icon name={icon} size={14} className={sectionStyles.fieldIcon} />
        <dt className={sectionStyles.label}>{label}</dt>
        {action}
      </div>
      <dd className={`${sectionStyles.value} ${muted ? sectionStyles.valueMuted : ''}`}>{children}</dd>
    </div>
  );
}

function FieldAction({ label, accessibleName, onClick, disabled }: { label: string; accessibleName: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`sx-btn sx-btn-ghost sx-btn-sm ${sectionStyles.fieldAction}`}
      aria-label={accessibleName}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
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
export function PickupDateDialog({
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

/**
 * Date of cremation / date received (2026-10). Both are facts about the
 * case, stored on it, and never moved onto the pickup appointment.
 */
function CaseDateDialog({
  title,
  label,
  initialDate,
  organizationToday,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  title: string;
  label: string;
  initialDate: string;
  organizationToday: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (isoDate: string) => void;
}) {
  const [date, setDate] = useState(initialDate);
  const inFuture = Boolean(date) && Boolean(organizationToday) && date > organizationToday;

  return (
    <Modal open onClose={busy ? () => undefined : onCancel} title={title} size="lg">
      <div className={`sx-modal-header ${styles.header}`}>
        <div className={styles.headerText}>
          <h2 className="sx-modal-title">{title}</h2>
        </div>
        <button type="button" className="sx-icon-btn" aria-label="Close" onClick={onCancel} disabled={busy}>
          ×
        </button>
      </div>
      <div className={`sx-modal-body ${styles.body}`}>
        <div className="sx-field">
          <label className="sx-label sx-label-required" htmlFor="cremains-case-date">
            {label}
          </label>
          <input
            id="cremains-case-date"
            type="date"
            className={`sx-input ${styles.input}`}
            value={date}
            max={organizationToday || undefined}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        {inFuture && (
          <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
            <span className={styles.noticeIcon} aria-hidden="true">
              !
            </span>
            <span>{label} cannot be in the future.</span>
          </p>
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
        <button type="button" className="sx-btn sx-btn-primary" disabled={busy || !date || inFuture} onClick={() => onSubmit(date)}>
          {busy ? 'Saving…' : 'Save Date'}
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

  const [dialog, setDialog] = useState<'add' | 'edit' | 'receive' | 'cremationDate' | 'receivedDate' | null>(null);
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
  const cremationDate = caseDateToIso(case_?.dateOfCremation);
  // Only the stored date — never the expected pickup date (see dateReceivedOf).
  const dateReceived = dateReceivedOf(case_, received);
  const receivedDate = dateReceived.kind === 'recorded' ? dateReceived.date : null;

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
   * single source of truth for WHETHER the cremains are in hand: ticking it
   * is what the server's own sync turns into a completed pickup, so there
   * are never two independent receipt states to reconcile.
   *
   * WHEN they arrived is stored on the case (`cremainsReceivedAt`), in the
   * same patch as the tick. It used to be stored by moving the pickup's
   * expected date onto the receipt date, which lost the expected date.
   */
  function submitReceipt(input: { receivedOn: string; note: string }) {
    setError(null);
    const settings = resolveCremainsPickupSettingsById(organizationId);
    const item = settings.receiptChecklistItem;
    if (!case_ || item.displayStage < 0) {
      setError('This organization has no cremains receipt task configured, so receipt cannot be recorded here.');
      return;
    }
    const receivedAt = isoToCaseDate(input.receivedOn);
    if (!receivedAt) {
      setError('Enter the date the cremains were received.');
      return;
    }
    caseMutations.updateCaseInfo({
      // Only this key (case concurrency): the server merges it onto the case as it is now.
      checklistState: writeChecklistValue({}, item.displayStage, item.index, true),
      cremainsReceivedAt: receivedAt,
    });
    closeDialog();
  }

  function submitCaseDate(field: 'dateOfCremation' | 'cremainsReceivedAt', isoDate: string) {
    setError(null);
    const value = isoToCaseDate(isoDate);
    if (!value) {
      setError('Enter a valid date.');
      return;
    }
    caseMutations.updateCaseInfo({ [field]: value });
    closeDialog();
  }

  const busy = createPickup.isPending || updateDate.isPending || confirmAppointment.isPending;

  const canEditCaseDates = canSchedule && Boolean(case_) && case_?.isDeleted !== true;
  const canActOnPickup = canSchedule && Boolean(pickup) && !received;

  return (
    <section className={sectionStyles.card} aria-label="Cremains pickup">
      <div className={sectionStyles.header}>
        <div className={sectionStyles.heading}>
          <span className={sectionStyles.headingIcon} aria-hidden="true">
            <Icon name="flame" size={15} />
          </span>
          <h3 className={sectionStyles.title}>Cremains Pickup</h3>
          {status && <span className={`sx-status ${statusClass(status)} ${sectionStyles.badge}`}>{PICKUP_STATUS_LABEL[status]}</span>}
        </div>

        {canActOnPickup && pickup && (
          <div className={sectionStyles.actions}>
            {status !== 'confirmed' && (
              <button
                type="button"
                className="sx-btn sx-btn-sm"
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
            <button type="button" className="sx-btn sx-btn-primary sx-btn-sm" onClick={() => setDialog('receive')} disabled={busy}>
              Mark Received
            </button>
          </div>
        )}
      </div>

      <dl className={sectionStyles.grid}>
        <Field
          icon="flame"
          label="Date of Cremation"
          muted={!cremationDate}
          action={
            canEditCaseDates && (
              <FieldAction
                label={cremationDate ? 'Edit' : 'Add'}
                accessibleName={cremationDate ? 'Edit date of cremation' : 'Add date of cremation'}
                onClick={() => setDialog('cremationDate')}
                disabled={busy}
              />
            )
          }
        >
          {cremationDate ? formatPickupDate(cremationDate) : 'Not recorded'}
        </Field>

        <Field
          icon="calendar"
          label="Expected Pickup"
          muted={!expected}
          action={
            canActOnPickup && expected && (
              <FieldAction label="Edit" accessibleName="Edit expected pickup date" onClick={() => setDialog('edit')} disabled={busy} />
            )
          }
        >
          {expected ? formatPickupDate(expected) : 'Not scheduled'}
          {pickup && expected && (
            // Date source: secondary information, not a field of its own.
            <span
              className={sectionStyles.secondary}
              title={
                isManuallyDecided(pickup)
                  ? 'This date was entered or changed by staff.'
                  : "This date was calculated automatically from the paperwork date and the organization's pickup days."
              }
            >
              <Icon name="info" size={12} />
              {isManuallyDecided(pickup) ? 'Set by staff' : 'Automatically calculated'}
            </span>
          )}
          {!pickup && canSchedule && (
            <div className={sectionStyles.inlineAdd}>
              <button type="button" className="sx-btn sx-btn-primary sx-btn-sm" onClick={() => setDialog('add')}>
                Add Expected Pickup
              </button>
            </div>
          )}
        </Field>

        <Field
          icon="checkCircle"
          label="Date Received"
          muted={!receivedDate}
          action={
            canEditCaseDates &&
            dateReceived.kind !== 'not_received' && (
              <FieldAction
                label={receivedDate ? 'Edit' : 'Add date'}
                accessibleName={receivedDate ? 'Edit date received' : 'Add date received'}
                onClick={() => setDialog('receivedDate')}
                disabled={busy}
              />
            )
          }
        >
          {/* Only the recorded date; never the expected pickup (dateReceivedOf). */}
          {dateReceivedLabel(dateReceived, formatPickupDate)}
        </Field>

        <Field icon="document" label="Paperwork Sent" muted={!paperworkDate}>
          {paperworkDate ? formatPickupDate(paperworkDate) : 'Not recorded'}
        </Field>

        <Field icon="tasks" label="Status" muted={!status}>
          {status ? PICKUP_STATUS_LABEL[status] : 'Not scheduled'}
        </Field>
      </dl>

      {status === 'overdue' && (
        <p className={sectionStyles.notice} role="status">
          The expected date has passed and the cremains have not been marked received.
        </p>
      )}

      {error && !dialog && (
        <p className={`sx-error-state ${sectionStyles.error}`} role="alert">
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

      {(dialog === 'cremationDate' || dialog === 'receivedDate') && (
        <CaseDateDialog
          title={dialog === 'cremationDate' ? 'Date of Cremation' : 'Date Cremains Received'}
          label={dialog === 'cremationDate' ? 'Date of cremation' : 'Date received'}
          initialDate={dialog === 'cremationDate' ? cremationDate : (receivedDate ?? '')}
          organizationToday={organizationToday}
          busy={caseMutations.isPending}
          error={error}
          onCancel={closeDialog}
          onSubmit={(iso) => submitCaseDate(dialog === 'cremationDate' ? 'dateOfCremation' : 'cremainsReceivedAt', iso)}
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

// Re-exported so this component's own tests and callers keep one import
// site; the single implementation lives in the client-safe domain module.
export { formatPickupDate, paperworkDateFromNotes };
