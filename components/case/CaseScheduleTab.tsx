'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useCaseAppointments, useConfirmAppointment, useCancelAppointment, useCompleteAppointment } from '@/hooks/useAppointments';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { ConfirmActionDialog } from '@/components/settings/ConfirmActionDialog';
import { APPOINTMENT_STATUS_LABEL, appointmentStatusVariant } from '@/domain/scheduling/appointmentDisplay';
import { getAppointmentTypeDefinition } from '@/domain/scheduling/appointmentTypeRegistry';
import { formatAppointmentDate, formatAppointmentTime } from '@/utils/scheduling';
import { isTerminalAppointmentStatus, type Appointment } from '@/types/appointment';
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
 */
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

  if (appointmentsQuery.isPending) return <p className={styles.loading}>Loading schedule…</p>;
  if (appointmentsQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load the schedule. Please try again.</p>;

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

    return (
      <div key={appointment.id} className={styles.row}>
        <div className={styles.identity}>
          <span className={styles.title}>{appointment.title}</span>
          <span className={styles.meta}>
            {typeLabel} · {formatAppointmentDate(appointment.startAt, appointment.timezone)} · {formatAppointmentTime(appointment.startAt, appointment.timezone)}–
            {formatAppointmentTime(appointment.endAt, appointment.timezone)}
          </span>
        </div>
        <Badge variant={appointmentStatusVariant(appointment.status)}>{APPOINTMENT_STATUS_LABEL[appointment.status]}</Badge>
        {!isTerminal && (
          <div className={styles.actions}>
            {canEdit && (appointment.status === 'draft' || appointment.status === 'scheduled') && (
              <Button variant="secondary" onClick={() => confirmAppointment.mutate(appointment.id)} disabled={confirmAppointment.isPending}>
                Confirm
              </Button>
            )}
            {canEdit && (
              <>
                <Button variant="secondary" onClick={() => setCompletingAppointment({ appointment, outcome: 'completed' })}>
                  Complete
                </Button>
                <Button variant="ghost" onClick={() => setCompletingAppointment({ appointment, outcome: 'no_show' })}>
                  No Show
                </Button>
              </>
            )}
            {canCancel && (
              <Button variant="ghost" onClick={() => setCancellingAppointment(appointment)}>
                Cancel
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.toolbar}>
        {canCreate && <Button onClick={() => setScheduleOpen(true)}>Schedule Appointment</Button>}
      </div>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Upcoming</h3>
        {upcoming.length === 0 ? <EmptyState message="No upcoming appointments for this case." /> : <Card className={styles.listCard}>{upcoming.map(renderRow)}</Card>}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Completed</h3>
        {completed.length === 0 ? <EmptyState message="No completed appointments yet." /> : <Card className={styles.listCard}>{completed.map(renderRow)}</Card>}
      </section>

      {cancelled.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Cancelled</h3>
          <Card className={styles.listCard}>{cancelled.map(renderRow)}</Card>
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
