'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useCaseAppointments, useConfirmAppointment, useCancelAppointment, useCompleteAppointment } from '@/hooks/useAppointments';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowMenu, type RowMenuItem } from '@/components/ui/RowMenu';
import { ConfirmActionDialog } from '@/components/settings/ConfirmActionDialog';
import { APPOINTMENT_STATUS_LABEL, appointmentStatusVariant } from '@/domain/scheduling/appointmentDisplay';
import { getAppointmentTypeDefinition } from '@/domain/scheduling/appointmentTypeRegistry';
import { formatAppointmentDate, formatAppointmentTime } from '@/utils/scheduling';
import { isTerminalAppointmentStatus, type Appointment, type AppointmentStatus } from '@/types/appointment';
import { AppointmentDialog } from '@/components/scheduling/AppointmentDialog';
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
  const upcoming = appointments.filter((a) => !isTerminalAppointmentStatus(a.status)).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const completed = appointments.filter((a) => a.status === 'completed' || a.status === 'no_show').sort((a, b) => b.startAt.localeCompare(a.startAt));
  const cancelled = appointments.filter((a) => a.status === 'cancelled').sort((a, b) => b.startAt.localeCompare(a.startAt));

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
          <div className="sx-row-actions" style={{ minWidth: 150 }}>
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
      <div className="sx-sched-toolbar">
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Schedule</h2>
        {canCreate && (
          <button type="button" className="sx-btn sx-btn-primary" onClick={() => setScheduleOpen(true)}>
            Schedule Appointment
          </button>
        )}
      </div>

      <section className="sx-sched-section">
        <h3 className="sx-section-title">
          Upcoming<span className="sx-section-meta">{upcoming.length} appointment(s)</span>
        </h3>
        {upcoming.length === 0 ? (
          <EmptyState message="No upcoming appointments for this case." helperText={canCreate ? 'Use “Schedule appointment” to add one.' : undefined} />
        ) : (
          upcoming.map(renderRow)
        )}
      </section>

      <section className="sx-sched-section">
        <h3 className="sx-section-title">
          Completed<span className="sx-section-meta">{completed.length} appointment(s)</span>
        </h3>
        {completed.length === 0 ? <EmptyState message="No completed appointments yet." /> : completed.map(renderRow)}
      </section>

      {cancelled.length > 0 && (
        <section className="sx-sched-section">
          <h3 className="sx-section-title">
            Cancelled<span className="sx-section-meta">{cancelled.length} appointment(s)</span>
          </h3>
          {cancelled.map(renderRow)}
        </section>
      )}

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
