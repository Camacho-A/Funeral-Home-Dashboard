'use client';

import { use } from 'react';
import { useFamilyAppointments } from '@/hooks/useFamilyPortal';
import { buildFamilyAppointmentIcsUrl } from '@/lib/familyClient';
import { FamilyCaseNav } from '@/components/family/FamilyCaseNav';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatAppointmentDate, formatAppointmentTime } from '@/utils/scheduling';
import styles from '@/components/family/FamilyCaseSection.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). Read-only — no
 * rescheduling capability exists anywhere on the family side (the
 * approved plan's own explicit scope boundary).
 */
export default function FamilyAppointmentsPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const appointmentsQuery = useFamilyAppointments(caseId);

  if (appointmentsQuery.isPending) return <p className={styles.loading}>Loading appointments…</p>;
  if (appointmentsQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load appointments. Please try again.</p>;

  const appointments = appointmentsQuery.data ?? [];

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Appointments</h1>
      <FamilyCaseNav caseId={caseId} />

      {appointments.length === 0 ? (
        <EmptyState message="No appointments scheduled for this case." />
      ) : (
        <Card className={styles.listCard}>
          {appointments.map((appointment) => (
            <div key={appointment.id} className={styles.row}>
              <div className={styles.identity}>
                <span className={styles.title}>{appointment.title}</span>
                <span className={styles.meta}>
                  {formatAppointmentDate(appointment.startAt, appointment.timezone)} · {formatAppointmentTime(appointment.startAt, appointment.timezone)}–
                  {formatAppointmentTime(appointment.endAt, appointment.timezone)}
                </span>
                {appointment.cancelledAt && appointment.cancelReason && <span className={styles.meta}>Cancelled: {appointment.cancelReason}</span>}
              </div>
              <div className={styles.actions}>
                <Badge variant={appointment.status === 'completed' || appointment.status === 'confirmed' ? 'success' : appointment.status === 'cancelled' || appointment.status === 'no_show' ? 'danger' : 'brand'}>
                  {appointment.status}
                </Badge>
                <a href={buildFamilyAppointmentIcsUrl(caseId, appointment.id)}>
                  <Button variant="secondary">Add to calendar</Button>
                </a>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
