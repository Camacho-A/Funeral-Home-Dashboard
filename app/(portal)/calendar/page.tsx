'use client';

import { useMemo, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useAppointments } from '@/hooks/useAppointments';
import { useResources } from '@/hooks/useResources';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/SelectField';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { AppointmentDialog } from '@/components/scheduling/AppointmentDialog';
import { APPOINTMENT_STATUS_LABEL, appointmentStatusVariant } from '@/domain/scheduling/appointmentDisplay';
import { getAppointmentTypeDefinition } from '@/domain/scheduling/appointmentTypeRegistry';
import { formatAppointmentTime, getCalendarRange, getMonthGridDays, getWeekDays, isSameDay, addDays, WEEKDAY_LABELS, type CalendarView } from '@/utils/scheduling';
import type { Appointment } from '@/types/appointment';
import styles from './page.module.css';

const VIEWS: CalendarView[] = ['day', 'week', 'month', 'agenda'];
const VIEW_LABEL: Record<CalendarView, string> = { day: 'Day', week: 'Week', month: 'Month', agenda: 'Agenda' };

/**
 * Phase 27 (Scheduling & Resource Management). The org-wide Calendar page.
 * Per the approved plan's invariant, Day/Week/Month/Agenda are pure
 * client-side projections of one identical `GET /api/scheduling/appointments`
 * query — `getCalendarRange` computes only the `from`/`to` bounds that
 * differ per view; the same `useAppointments` hook and the same
 * `resourceFilter` param feed every one of them.
 */
export default function CalendarPage() {
  const { organizationId } = useOrganization();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const resourcesQuery = useResources(organizationId);

  const [view, setView] = useState<CalendarView>('agenda');
  const [anchor, setAnchor] = useState(() => new Date());
  const [resourceFilter, setResourceFilter] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const range = useMemo(() => getCalendarRange(view, anchor), [view, anchor]);
  const appointmentsQuery = useAppointments(organizationId, { from: range.from, to: range.to, resourceId: resourceFilter || undefined });

  const permissions = myPermissionsQuery.isSuccess ? myPermissionsQuery.data.permissions : null;
  const canCreate = permissions === null || permissions.includes('schedule.create');

  const appointments = appointmentsQuery.data ?? [];
  const resources = resourcesQuery.data ?? [];

  function step(direction: 1 | -1) {
    const days = view === 'day' ? 1 : view === 'week' ? 7 : view === 'month' ? 30 : 30;
    setAnchor((current) => addDays(current, direction * days));
  }

  function renderAppointmentChip(appointment: Appointment) {
    const typeLabel = getAppointmentTypeDefinition(appointment.appointmentType)?.displayName ?? appointment.appointmentType;
    return (
      <div key={appointment.id} className={styles.chip}>
        <span className={styles.chipTime}>{formatAppointmentTime(appointment.startAt, appointment.timezone)}</span>
        <span className={styles.chipTitle}>{appointment.title}</span>
        <span className={styles.chipType}>{typeLabel}</span>
        <Badge variant={appointmentStatusVariant(appointment.status)}>{APPOINTMENT_STATUS_LABEL[appointment.status]}</Badge>
      </div>
    );
  }

  function renderAgenda() {
    if (appointmentsQuery.isPending) return <p className={styles.loading}>Loading appointments…</p>;
    if (appointments.length === 0) return <EmptyState message="No appointments in this window." />;
    const sorted = [...appointments].sort((a, b) => a.startAt.localeCompare(b.startAt));
    const groups = new Map<string, Appointment[]>();
    for (const appointment of sorted) {
      const dayKey = appointment.startAt.slice(0, 10);
      if (!groups.has(dayKey)) groups.set(dayKey, []);
      groups.get(dayKey)!.push(appointment);
    }
    return (
      <div className={styles.agenda}>
        {[...groups.entries()].map(([dayKey, dayAppointments]) => (
          <div key={dayKey} className={styles.agendaGroup}>
            <div className={styles.agendaDate}>{new Date(`${dayKey}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
            <div className={styles.agendaList}>{dayAppointments.map(renderAppointmentChip)}</div>
          </div>
        ))}
      </div>
    );
  }

  function renderDay() {
    if (appointmentsQuery.isPending) return <p className={styles.loading}>Loading appointments…</p>;
    const dayAppointments = [...appointments].sort((a, b) => a.startAt.localeCompare(b.startAt));
    if (dayAppointments.length === 0) return <EmptyState message="No appointments on this day." />;
    return <div className={styles.agendaList}>{dayAppointments.map(renderAppointmentChip)}</div>;
  }

  function renderWeek() {
    const days = getWeekDays(anchor);
    return (
      <div className={styles.weekGrid}>
        {days.map((day) => {
          const dayAppointments = appointments.filter((a) => isSameDay(new Date(a.startAt), day)).sort((a, b) => a.startAt.localeCompare(b.startAt));
          return (
            <div key={day.toISOString()} className={styles.weekColumn}>
              <div className={styles.weekColumnHeader}>{day.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}</div>
              <div className={styles.weekColumnList}>
                {dayAppointments.length === 0 ? <span className={styles.weekEmpty}>—</span> : dayAppointments.map((a) => (
                  <button key={a.id} type="button" className={styles.weekChip} onClick={() => { setAnchor(day); setView('day'); }}>
                    {formatAppointmentTime(a.startAt, a.timezone)} {a.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderMonth() {
    const days = getMonthGridDays(anchor);
    const currentMonth = anchor.getMonth();
    return (
      <div className={styles.monthGrid}>
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className={styles.monthWeekdayLabel}>
            {label}
          </div>
        ))}
        {days.map((day) => {
          const dayAppointments = appointments.filter((a) => isSameDay(new Date(a.startAt), day));
          const isOutsideMonth = day.getMonth() !== currentMonth;
          return (
            <button
              key={day.toISOString()}
              type="button"
              className={[styles.monthCell, isOutsideMonth ? styles.monthCellOutside : ''].filter(Boolean).join(' ')}
              onClick={() => {
                setAnchor(day);
                setView('day');
              }}
            >
              <span className={styles.monthCellDate}>{day.getDate()}</span>
              {dayAppointments.slice(0, 3).map((a) => (
                <span key={a.id} className={styles.monthCellChip}>
                  {a.title}
                </span>
              ))}
              {dayAppointments.length > 3 && <span className={styles.monthCellMore}>+{dayAppointments.length - 3} more</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <h1 className={styles.title}>Calendar</h1>

      <div className={styles.toolbar}>
        <div className={styles.viewToggle} role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={view === v ? styles.viewButtonActive : styles.viewButton}
              onClick={() => setView(v)}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>

        <div className={styles.navGroup}>
          <Button variant="ghost" onClick={() => step(-1)}>
            ←
          </Button>
          <Button variant="ghost" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
          <Button variant="ghost" onClick={() => step(1)}>
            →
          </Button>
        </div>

        <SelectField value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)} className={styles.resourceFilter}>
          <option value="">All resources</option>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.name}
            </option>
          ))}
        </SelectField>

        {canCreate && <Button onClick={() => setScheduleOpen(true)}>+ New Appointment</Button>}
      </div>

      <div className={styles.card}>
        {view === 'agenda' && renderAgenda()}
        {view === 'day' && renderDay()}
        {view === 'week' && renderWeek()}
        {view === 'month' && renderMonth()}
      </div>

      <AppointmentDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} organizationId={organizationId} defaultStartAt={anchor.toISOString()} />
    </div>
  );
}
