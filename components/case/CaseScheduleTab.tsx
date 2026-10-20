'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useCaseAppointments, useConfirmAppointment, useCancelAppointment, useCompleteAppointment } from '@/hooks/useAppointments';
import { Icon } from '@/components/ui/Icon';
import { RowMenu, type RowMenuItem } from '@/components/ui/RowMenu';
import { ConfirmActionDialog } from '@/components/settings/ConfirmActionDialog';
import { APPOINTMENT_STATUS_LABEL, appointmentStatusVariant } from '@/domain/scheduling/appointmentDisplay';
import { getAppointmentTypeDefinition } from '@/domain/scheduling/appointmentTypeRegistry';
import { formatAppointmentDate, formatAppointmentTime } from '@/utils/scheduling';
import { isTerminalAppointmentStatus, type Appointment, type AppointmentStatus } from '@/types/appointment';
import { AppointmentDialog } from '@/components/scheduling/AppointmentDialog';
import { CremainsPickupSection } from './CremainsPickupSection';
import { isExpectedCremainsPickup } from '@/domain/scheduling/cremainsPickupPresentation';
import { useCase } from '@/hooks/useCase';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import styles from './CaseScheduleTab.module.css';

/**
 * Phase 27 (Scheduling & Resource Management). The Case Detail page's
 * "Schedule" tab — a real, persisted appointment list backed by
 * `GET /api/cases/[caseId]/appointments`, structurally the same
 * self-fetching `{ caseId }`-only tab shape as `CaseActivityTab.tsx`/
 * `CaseDocumentsTab.tsx`. Upcoming/Completed/Cancelled sections are all
 * derived client-side from the one fetched list — no separate "history"
 * endpoint, matching that route's own header comment.
 *
 * SOLIS Final Phase §8.4 (2026-10): row actions move into a shared
 * `RowMenu` ("Mark completed" / "Mark no show" / divider / "Cancel
 * appointment", each under its existing condition) — the visible "Confirm"
 * button is the only action still inline. Chose the spec's own documented
 * fallback for the <560px case ("always include Confirm as the first menu
 * item and keep the inline button") over the `window.matchMedia` variant,
 * to avoid a client-only media query in the render path; the inline
 * Confirm is CSS-hidden below 560px (`.confirmInline`), and the menu's own
 * "Confirm" item is unconditional. The status-color mapping below follows
 * `appointmentStatusVariant` (the existing, already-tested Badge variant:
 * success→ok, danger→bad, brand→info, neutral→plain) rather than the
 * spec's literal per-status prose table, which would have made
 * completed/no_show/cancelled all render identically plain — losing the
 * existing semantic color distinction for no real reason; see this
 * phase's own final report.
 */
function statusClass(status: AppointmentStatus): string {
  const variant = appointmentStatusVariant(status);
  if (variant === 'success') return 'sx-status-ok';
  if (variant === 'danger') return 'sx-status-bad';
  if (variant === 'brand') return 'sx-status-info';
  return '';
}

export function CaseScheduleTab({ caseId }: { caseId: string }) {
  const { organizationId } = useOrganization();
  const appointmentsQuery = useCaseAppointments(organizationId, caseId);
  const myPermissionsQuery = useMyPermissions(organizationId);
  const confirmAppointment = useConfirmAppointment(organizationId);
  const cancelAppointment = useCancelAppointment(organizationId);
  const completeAppointment = useCompleteAppointment(organizationId);
  // Needed only so the cremains section can write the organization's own
  // receipt checklist item and resolve its local "today".
  const caseQuery = useCase(caseId);
  const organizationRecord = useOrganizationRecord();

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [cancellingAppointment, setCancellingAppointment] = useState<Appointment | null>(null);
  const [completingAppointment, setCompletingAppointment] = useState<{ appointment: Appointment; outcome: 'completed' | 'no_show' } | null>(null);

  if (appointmentsQuery.isPending) {
    return (
      <div className="sx-loading" aria-busy="true">
        <span className="sx-skeleton" style={{ width: '90%' }} />
        <span className="sx-skeleton" style={{ width: '70%' }} />
        <span className="sx-skeleton" style={{ width: '80%' }} />
        <span className="sr-only">Loading schedule…</span>
      </div>
    );
  }
  if (appointmentsQuery.isError) return <div className="sx-error-state" role="alert">Couldn&rsquo;t load the schedule. Please try again.</div>;

  const permissions = myPermissionsQuery.isSuccess ? myPermissionsQuery.data.permissions : null;
  const canCreate = permissions === null || permissions.includes('schedule.create');
  const canEdit = permissions === null || permissions.includes('schedule.edit');
  const canCancel = permissions === null || permissions.includes('schedule.cancel');

  const appointments = appointmentsQuery.data ?? [];
  // The expected cremains pickup has its own dedicated section above, so
  // it is deliberately excluded from the generic lists — one pickup, one
  // card, never presented twice.
  const generalAppointments = appointments.filter((a) => !isExpectedCremainsPickup(a));
  const upcoming = generalAppointments.filter((a) => !isTerminalAppointmentStatus(a.status)).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const completed = generalAppointments.filter((a) => a.status === 'completed' || a.status === 'no_show').sort((a, b) => b.startAt.localeCompare(a.startAt));
  const cancelled = generalAppointments.filter((a) => a.status === 'cancelled').sort((a, b) => b.startAt.localeCompare(a.startAt));

  function renderRow(appointment: Appointment) {
    const typeLabel = getAppointmentTypeDefinition(appointment.appointmentType)?.displayName ?? appointment.appointmentType;
    const isTerminal = isTerminalAppointmentStatus(appointment.status);
    const canConfirm = canEdit && (appointment.status === 'draft' || appointment.status === 'scheduled');
    const MON = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: appointment.timezone }).format(new Date(appointment.startAt)).toUpperCase();
    const DD = new Intl.DateTimeFormat('en-US', { day: '2-digit', timeZone: appointment.timezone }).format(new Date(appointment.startAt));

    const menuItems: RowMenuItem[] = [];
    if (canConfirm) menuItems.push({ label: 'Confirm', onSelect: () => confirmAppointment.mutate(appointment.id) });
    if (canEdit) {
      menuItems.push({ label: 'Mark completed', onSelect: () => setCompletingAppointment({ appointment, outcome: 'completed' }) });
      menuItems.push({ label: 'Mark no show', onSelect: () => setCompletingAppointment({ appointment, outcome: 'no_show' }) });
    }
    if (canCancel) menuItems.push({ label: 'Cancel appointment', onSelect: () => setCancellingAppointment(appointment), danger: true, dividerBefore: canEdit });

    return (
      <div key={appointment.id} className="sx-sched-row" data-terminal={isTerminal || undefined}>
        <div className="sx-sched-date" aria-hidden="true">
          <span className="sx-sched-month">{MON}</span>
          <span className="sx-sched-day">{DD}</span>
        </div>
        <div>
          <div className="sx-sched-title">{appointment.title}</div>
          <div className="sx-sched-meta">
            {typeLabel} · {formatAppointmentDate(appointment.startAt, appointment.timezone)} · {formatAppointmentTime(appointment.startAt, appointment.timezone)}–
            {formatAppointmentTime(appointment.endAt, appointment.timezone)}
          </div>
        </div>
        <span className={`sx-status ${statusClass(appointment.status)}`}>{APPOINTMENT_STATUS_LABEL[appointment.status]}</span>
        {!isTerminal && (
          <div className={`sx-row-actions ${styles.rowActions}`}>
            {canConfirm && (
              <button
                type="button"
                className={`sx-btn sx-btn-secondary sx-btn-sm ${styles.confirmInline}`}
                onClick={() => confirmAppointment.mutate(appointment.id)}
                disabled={confirmAppointment.isPending}
              >
                Confirm
              </button>
            )}
            <RowMenu label={`${appointment.title} actions`} items={menuItems} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="sx-sched">
      {/* Expected Cremains Pickup (2026-10). A read-only summary of what
          the generic appointment row below cannot express — the derived
          Overdue state, the paperwork date, and whether the date is still
          automatic. Every ACTION stays on the row itself, so there is only
          one place to confirm, re-date or receive. */}
      <CremainsPickupSection
        caseId={caseId}
        organizationId={organizationId}
        appointments={appointments}
        case_={caseQuery.data ?? null}
        canSchedule={canCreate}
        organizationTimezone={organizationRecord.data?.timezone}
      />

      {/* Schedule (redesign, 2026-10): its own card under the pickup.
          Upcoming is always shown; Completed and Cancelled only when they
          have something in them. */}
      <section className={styles.scheduleCard} aria-labelledby="case-schedule-heading">
        <div className={styles.scheduleHeader}>
          <h2 id="case-schedule-heading" className={styles.scheduleTitle}>
            <span className={styles.scheduleIcon} aria-hidden="true">
              <Icon name="calendar" size={15} />
            </span>
            Schedule
          </h2>
          {canCreate && (
            <button type="button" className={`sx-btn sx-btn-primary sx-btn-sm ${styles.scheduleButton}`} onClick={() => setScheduleOpen(true)}>
              Schedule Appointment
            </button>
          )}
        </div>

        <div className={styles.group}>
          <h3 className={styles.groupTitle}>
            Upcoming<span className={styles.groupMeta}>{upcoming.length}</span>
          </h3>
          {upcoming.length === 0 ? <p className={styles.empty}>No upcoming appointments</p> : upcoming.map(renderRow)}
        </div>

        {completed.length > 0 && (
          <div className={styles.group}>
            <h3 className={styles.groupTitle}>
              Completed<span className={styles.groupMeta}>{completed.length}</span>
            </h3>
            {completed.map(renderRow)}
          </div>
        )}

        {cancelled.length > 0 && (
          <div className={styles.group}>
            <h3 className={styles.groupTitle}>
              Cancelled<span className={styles.groupMeta}>{cancelled.length}</span>
            </h3>
            {cancelled.map(renderRow)}
          </div>
        )}
      </section>

      <AppointmentDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} organizationId={organizationId} caseId={caseId} />

      {cancellingAppointment && (
        <ConfirmActionDialog
          open
          onClose={() => setCancellingAppointment(null)}
          title="Cancel Appointment"
          message={`"${cancellingAppointment.title}" will be cancelled and any assigned resources released.`}
          confirmLabel="Cancel Appointment"
          onConfirm={async () => {
            await cancelAppointment.mutateAsync({ appointmentId: cancellingAppointment.id });
          }}
        />
      )}

      {completingAppointment && (
        <ConfirmActionDialog
          open
          onClose={() => setCompletingAppointment(null)}
          title={completingAppointment.outcome === 'completed' ? 'Mark Completed' : 'Mark No Show'}
          message={`"${completingAppointment.appointment.title}" will be marked as ${completingAppointment.outcome === 'completed' ? 'completed' : 'a no-show'} and any assigned resources released. This can&rsquo;t be undone.`}
          confirmLabel={completingAppointment.outcome === 'completed' ? 'Mark Completed' : 'Mark No Show'}
          onConfirm={async () => {
            await completeAppointment.mutateAsync({ appointmentId: completingAppointment.appointment.id, outcome: completingAppointment.outcome });
          }}
        />
      )}
    </div>
  );
}
