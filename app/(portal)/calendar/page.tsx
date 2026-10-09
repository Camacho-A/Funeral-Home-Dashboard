'use client';

import { useMemo, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { isExpectedCremainsPickup } from '@/domain/scheduling/cremainsPickupPresentation';
import { useMyPermissions } from '@/hooks/useRbac';
import { useAppointments } from '@/hooks/useAppointments';
import { useResources } from '@/hooks/useResources';
import { useCalendarSyncLinks } from '@/hooks/useCalendarIntegrations';
import { useCases } from '@/hooks/useCases';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { EmptyState } from '@/components/ui/EmptyState';
import { AppointmentDialog } from '@/components/scheduling/AppointmentDialog';
import { APPOINTMENT_STATUS_LABEL, appointmentStatusVariant } from '@/domain/scheduling/appointmentDisplay';
import { getAppointmentTypeDefinition } from '@/domain/scheduling/appointmentTypeRegistry';
import { toDisplayName } from '@/utils/displayName';
import {
  formatAppointmentTime,
  getCalendarRange,
  getMonthGridDays,
  getWeekDays,
  isSameDay,
  addDays,
  WEEKDAY_LABELS,
  type CalendarView,
} from '@/utils/scheduling';
import { isTerminalAppointmentStatus, type Appointment } from '@/types/appointment';
import type { CalendarSyncStatus } from '@/types/calendarEventLink';
import styles from './page.module.css';

const VIEWS: CalendarView[] = ['day', 'week', 'month', 'agenda'];
const VIEW_LABEL: Record<CalendarView, string> = { day: 'Day', week: 'Week', month: 'Month', agenda: 'Agenda' };

/** Phase 34 (Scheduling Integrations, Calendar Sync & Automated
    Reminders). An appointment with no link row at all is never
    connected — no tag renders for it (unobtrusive by omission, not
    a "not connected" label cluttering every appointment). */
const SYNC_STATUS_LABEL: Record<CalendarSyncStatus, string> = {
  pending: 'Sync pending',
  synced: 'Synced',
  retry_pending: 'Sync retrying',
  failed: 'Sync failed',
  disconnected: 'Calendar disconnected',
};

function syncTagStyle(status: CalendarSyncStatus): React.CSSProperties {
  if (status === 'failed' || status === 'disconnected') {
    return { background: 'var(--sx-red-bg)', color: 'var(--sx-red)' };
  }
  return {};
}

/** SOLIS Tasks/Calendar/Settings phase §2.3 — presentation-only range-label
    formatting from the existing `range`/`anchor`, per view. */
function formatRangeLabel(view: CalendarView, range: { from: string; to: string }, anchor: Date): string {
  if (view === 'day') {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(anchor);
  }
  if (view === 'month') {
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(anchor);
  }
  const start = new Date(range.from);
  const end = new Date(new Date(range.to).getTime() - 1);
  const startLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(start);
  const endLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(end);
  return `${startLabel} – ${endLabel}`;
}

function statusModifier(variant: ReturnType<typeof appointmentStatusVariant>): string {
  if (variant === 'success') return 'sx-status-ok';
  if (variant === 'brand') return 'sx-status-info';
  if (variant === 'danger') return 'sx-status-bad';
  return '';
}

/** Hour + a/p suffix, minutes only when non-zero ("9a", "1:30p"), in the
    appointment's own timezone — §2.4's week-chip time format. */
function formatChipTime(isoString: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hour12: true, timeZone: timezone }).formatToParts(new Date(isoString));
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const dayPeriod = (parts.find((p) => p.type === 'dayPeriod')?.value ?? '').toLowerCase().charAt(0);
  return minute === '00' ? `${hour}${dayPeriod}` : `${hour}:${minute}${dayPeriod}`;
}

/**
 * Phase 27 (Scheduling & Resource Management). The org-wide Calendar page.
 * Per the approved plan's invariant, Day/Week/Month/Agenda are pure
 * client-side projections of one identical `GET /api/scheduling/appointments`
 * query — `getCalendarRange` computes only the `from`/`to` bounds that
 * differ per view; the same `useAppointments` hook and the same
 * `resourceFilter` param feed every one of them.
 *
 * SOLIS Tasks/Calendar/Settings phase, §2 (2026-10): presentation only.
 * `effectiveView` (narrow && week/month → agenda, per §2.5) only changes
 * which markup renders below 860px — `view` itself and the `range`/
 * `useAppointments` fetch it drives are completely unchanged, so switching
 * back to a wide viewport restores the real week/month grid with no
 * re-fetch.
 */
export default function CalendarPage() {
  const { organizationId } = useOrganization();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const resourcesQuery = useResources(organizationId);
  const casesQuery = useCases();

  const [view, setView] = useState<CalendarView>('agenda');
  const [anchor, setAnchor] = useState(() => new Date());
  const [resourceFilter, setResourceFilter] = useState('');
  /** Expected Cremains Pickup (2026-10). A presentation-only filter — it
      narrows what this calendar renders and changes no query, no data and
      no other event type. */
  const [typeFilter, setTypeFilter] = useState<'all' | 'cremains'>('all');
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const narrow = useMediaQuery('(max-width: 860px)');
  const effectiveView: CalendarView = narrow && (view === 'week' || view === 'month') ? 'agenda' : view;

  const range = useMemo(() => getCalendarRange(view, anchor), [view, anchor]);
  const appointmentsQuery = useAppointments(organizationId, { from: range.from, to: range.to, resourceId: resourceFilter || undefined });
  const syncLinksQuery = useCalendarSyncLinks(organizationId);
  const syncStatusByAppointmentId = useMemo(() => {
    const map = new Map<string, CalendarSyncStatus>();
    for (const link of syncLinksQuery.data ?? []) map.set(link.appointmentId, link.syncStatus);
    return map;
  }, [syncLinksQuery.data]);
  const caseNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of casesQuery.data ?? []) map.set(c.id, c.decedentName);
    return map;
  }, [casesQuery.data]);

  const permissions = myPermissionsQuery.isSuccess ? myPermissionsQuery.data.permissions : null;
  const canCreate = permissions === null || permissions.includes('schedule.create');

  const allAppointments = appointmentsQuery.data ?? [];
  const appointments =
    typeFilter === 'cremains' ? allAppointments.filter(isExpectedCremainsPickup) : allAppointments;
  /** How many expected pickups fall in the visible range — shown beside
      the filter so a Tuesday/Friday's load is legible at a glance. */
  const cremainsCount = allAppointments.filter(isExpectedCremainsPickup).length;
  const resources = resourcesQuery.data ?? [];

  function step(direction: 1 | -1) {
    const days = view === 'day' ? 1 : view === 'week' ? 7 : view === 'month' ? 30 : 30;
    setAnchor((current) => addDays(current, direction * days));
  }

  function moveViewTab(direction: 1 | -1) {
    const index = VIEWS.indexOf(view);
    const next = VIEWS[(index + direction + VIEWS.length) % VIEWS.length];
    setView(next);
  }

  function renderAgendaRow(appointment: Appointment) {
    const typeLabel = getAppointmentTypeDefinition(appointment.appointmentType)?.displayName ?? appointment.appointmentType;
    const isTerminal = isTerminalAppointmentStatus(appointment.status);
    const syncStatus = syncStatusByAppointmentId.get(appointment.id);
    const caseName = appointment.caseId ? caseNameById.get(appointment.caseId) : undefined;
    return (
      <div key={appointment.id} className="sx-agenda-row" data-terminal={isTerminal || undefined}>
        <span className="sx-agenda-time">
          {/* An expected cremains pickup is an ALL-DAY calendar date, not a
              wall-clock moment — rendering its anchor instants would show an
              invented pickup time. Every other event type is unchanged. */}
          {isExpectedCremainsPickup(appointment)
            ? 'All day'
            : `${formatAppointmentTime(appointment.startAt, appointment.timezone)}–${formatAppointmentTime(appointment.endAt, appointment.timezone)}`}
        </span>
        <div>
          <div className="sx-agenda-title">{appointment.title}</div>
          <div className="sx-agenda-meta">
            {typeLabel}
            {caseName ? ` · ${toDisplayName(caseName)}` : ''}
          </div>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`sx-status ${statusModifier(appointmentStatusVariant(appointment.status))}`}>{APPOINTMENT_STATUS_LABEL[appointment.status]}</span>
          {syncStatus && (
            <span className="sx-tag" style={syncTagStyle(syncStatus)}>
              {SYNC_STATUS_LABEL[syncStatus]}
            </span>
          )}
        </span>
      </div>
    );
  }

  function renderAgenda(list: Appointment[], emptyMessage: string) {
    if (appointmentsQuery.isPending) {
      return (
        <div className="sx-loading" aria-busy="true">
          <span className="sx-skeleton" style={{ width: '90%' }} />
          <span className="sx-skeleton" style={{ width: '70%' }} />
          <span className="sx-skeleton" style={{ width: '80%' }} />
          <span className="sr-only">Loading appointments…</span>
        </div>
      );
    }
    if (list.length === 0) return <EmptyState message={emptyMessage} />;
    const sorted = [...list].sort((a, b) => a.startAt.localeCompare(b.startAt));
    const groups = new Map<string, Appointment[]>();
    for (const appointment of sorted) {
      const dayKey = appointment.startAt.slice(0, 10);
      if (!groups.has(dayKey)) groups.set(dayKey, []);
      groups.get(dayKey)!.push(appointment);
    }
    const today = new Date();
    return (
      <div className="sx-agenda">
        {[...groups.entries()].map(([dayKey, dayAppointments]) => {
          const dayDate = new Date(`${dayKey}T00:00:00`);
          const isToday = isSameDay(dayDate, today);
          return (
            <div key={dayKey} className="sx-agenda-day" data-today={isToday || undefined}>
              <div className="sx-agenda-date">
                <div className="sx-agenda-dow">{isToday ? `${dayDate.toLocaleDateString('en-US', { weekday: 'short' })} · Today` : dayDate.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                <div className="sx-agenda-dnum">{dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
              </div>
              <div>{dayAppointments.map(renderAgendaRow)}</div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderDay() {
    if (appointmentsQuery.isPending) {
      return (
        <div className="sx-loading" aria-busy="true">
          <span className="sx-skeleton" style={{ width: '90%' }} />
          <span className="sx-skeleton" style={{ width: '70%' }} />
          <span className="sr-only">Loading appointments…</span>
        </div>
      );
    }
    if (appointments.length === 0) return <EmptyState message="No appointments on this day." />;
    const sorted = [...appointments].sort((a, b) => a.startAt.localeCompare(b.startAt));
    return (
      <div className="sx-agenda">
        <div className="sx-agenda-day" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div>{sorted.map(renderAgendaRow)}</div>
        </div>
      </div>
    );
  }

  function renderWeek() {
    const days = getWeekDays(anchor);
    const today = new Date();
    return (
      <div className="sx-week">
        {days.map((day) => {
          const dayAppointments = appointments.filter((a) => isSameDay(new Date(a.startAt), day)).sort((a, b) => a.startAt.localeCompare(b.startAt));
          return (
            <div key={day.toISOString()} className="sx-week-col" data-today={isSameDay(day, today) || undefined}>
              <div className="sx-week-head">
                <span className="sx-week-dow">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <span className="sx-week-date">{day.getDate()}</span>
              </div>
              <div className="sx-week-body">
                {dayAppointments.length === 0 ? (
                  <span className="sx-week-empty">—</span>
                ) : (
                  dayAppointments.map((a) => {
                    const isTerminal = isTerminalAppointmentStatus(a.status);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className="sx-chip"
                        data-status={a.status}
                        data-terminal={isTerminal || undefined}
                        onClick={() => {
                          setAnchor(day);
                          setView('day');
                        }}
                      >
                        <span className="sx-chip-time">{formatChipTime(a.startAt, a.timezone)}</span>
                        {a.title}
                      </button>
                    );
                  })
                )}
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
    const today = new Date();
    return (
      <div className="sx-month">
        <div className="sx-month-head">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label}>{label}</div>
          ))}
        </div>
        <div className="sx-month-grid">
          {days.map((day) => {
            const dayAppointments = appointments.filter((a) => isSameDay(new Date(a.startAt), day));
            const isOutsideMonth = day.getMonth() !== currentMonth;
            return (
              <div key={day.toISOString()} className="sx-month-cell" data-outside={isOutsideMonth || undefined} data-today={isSameDay(day, today) || undefined}>
                <button type="button" className="sx-month-day" aria-label={day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} onClick={() => { setAnchor(day); setView('day'); }}>
                  {day.getDate()}
                </button>
                {dayAppointments.slice(0, 2).map((a) => {
                  const isTerminal = isTerminalAppointmentStatus(a.status);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className="sx-chip"
                      data-status={a.status}
                      data-terminal={isTerminal || undefined}
                      onClick={() => {
                        setAnchor(day);
                        setView('day');
                      }}
                    >
                      <span className="sx-chip-time">{formatChipTime(a.startAt, a.timezone)}</span>
                      {a.title}
                    </button>
                  );
                })}
                {dayAppointments.length > 2 && (
                  <button type="button" className="sx-month-more" onClick={() => { setAnchor(day); setView('day'); }}>
                    +{dayAppointments.length - 2} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const weekForStrip = getWeekDays(anchor);

  return (
    <div>
      <div className="sx-page-header">
        <h1 className="sx-page-title">Calendar</h1>
        {canCreate && (
          <button type="button" className={`sx-btn sx-btn-primary ${styles.newButton}`} onClick={() => setScheduleOpen(true)}>
            <span className={styles.newLabelFull}>+ New appointment</span>
            <span className={styles.newLabelShort}>+ New</span>
          </button>
        )}
      </div>

      <div className="sx-cal-toolbar">
        <h2 className="sx-cal-title" aria-live="polite">
          {formatRangeLabel(view, range, anchor)}
        </h2>
        <div className="sx-cal-nav">
          <button type="button" className="sx-icon-btn" aria-label="Previous" onClick={() => step(-1)}>
            ‹
          </button>
          <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <button type="button" className="sx-icon-btn" aria-label="Next" onClick={() => step(1)}>
            ›
          </button>
        </div>
        <div className="sx-cal-spacer" />
        <label className="sx-filter" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <span className="sr-only">Event type</span>
          <select
            className="sx-select"
            style={{ width: 190, height: 32 }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value === 'cremains' ? 'cremains' : 'all')}
          >
            <option value="all">All event types</option>
            <option value="cremains">Cremains Pickups{cremainsCount > 0 ? ` (${cremainsCount})` : ''}</option>
          </select>
        </label>
        <label className="sx-filter" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <span className="sr-only">Resource</span>
          <select className="sx-select" style={{ width: 180, height: 32 }} value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)}>
            <option value="">All resources</option>
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
          </select>
        </label>
        <div
          className="sx-seg"
          role="tablist"
          aria-label="Calendar view"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              moveViewTab(1);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              moveViewTab(-1);
            }
          }}
        >
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              tabIndex={view === v ? 0 : -1}
              className={v === 'week' ? styles.viewTabWeek : v === 'month' ? styles.viewTabMonth : undefined}
              onClick={() => setView(v)}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {narrow && (
        <div className="sx-daystrip">
          {weekForStrip.map((day) => {
            const hasAppointments = appointments.some((a) => isSameDay(new Date(a.startAt), day));
            return (
              <button
                key={day.toISOString()}
                type="button"
                aria-pressed={isSameDay(day, anchor)}
                aria-label={day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                onClick={() => {
                  setAnchor(day);
                  setView('day');
                }}
              >
                <span className="sx-daystrip-dow">{day.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
                <span className="sx-daystrip-num">{day.getDate()}</span>
                <span className="sx-daystrip-dot" style={hasAppointments ? undefined : { visibility: 'hidden' }} />
              </button>
            );
          })}
        </div>
      )}

      {effectiveView === 'agenda' && renderAgenda(appointments, 'No appointments in this window.')}
      {effectiveView === 'day' && renderDay()}
      {effectiveView === 'week' && renderWeek()}
      {effectiveView === 'month' && renderMonth()}

      <AppointmentDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} organizationId={organizationId} defaultStartAt={anchor.toISOString()} />
    </div>
  );
}
