'use client';

import { useMemo, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import {
  cremainsChipLabel,
  formatPickupDate,
  isExpectedCremainsPickup,
  paperworkDateFromNotes,
  resolvePickupStatus,
  PICKUP_STATUS_LABEL,
} from '@/domain/scheduling/cremainsPickupPresentation';
import { organizationLocalDate } from '@/domain/scheduling/cremainsPickupSchedule';
import { expectedDateOf } from '@/domain/scheduling/cremainsPickupPresentation';
import { Modal } from '@/components/ui/Modal';
import Link from 'next/link';
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

/**
 * The semantic category a chip is coloured by (2026-10).
 *
 * Mapped onto the colour families the case workflow already uses, so the
 * calendar reads the same way the rest of SOLIS does — no new palette:
 *
 *   pickup-expected  navy/blue   in progress: scheduled, not yet here
 *   pickup-received  green       completed
 *   pickup-overdue   amber       needs attention
 *   appointment      neutral     everything else, deliberately quiet so it
 *                                never competes with a workflow status
 *
 * Derived purely from data already on the appointment plus the
 * organization's own today. Rendering never writes anything: a date
 * passing can colour a chip amber, and that is all it can ever do.
 */
type EventCategory = 'pickup-expected' | 'pickup-received' | 'pickup-overdue' | 'appointment';

const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  'pickup-expected': 'Expected Pickup',
  'pickup-received': 'Received',
  'pickup-overdue': 'Overdue',
  appointment: 'Appointments',
};

/** What a chip reads. A pickup says which case; everything else keeps its
    own title, and only a real timed event shows a time. */
function chipLabel(
  appointment: Appointment,
  case_: { caseNumber: string; decedentName: string } | undefined,
  compact: boolean,
): string {
  return isExpectedCremainsPickup(appointment) ? cremainsChipLabel(case_, { compact }) : appointment.title;
}

function eventCategory(appointment: Appointment, organizationToday: string): EventCategory {
  if (!isExpectedCremainsPickup(appointment)) return 'appointment';
  const status = resolvePickupStatus(appointment, organizationToday);
  if (status === 'received') return 'pickup-received';
  if (status === 'overdue') return 'pickup-overdue';
  return 'pickup-expected';
}

/**
 * The time shown on a week/month chip.
 *
 * An all-day event has no meaningful clock time, so it reads "All day"
 * rather than the midnight anchor its instants happen to carry — the same
 * treatment the agenda row already gives it. This matters more now that
 * Month is the default view: an expected cremains pickup is a calendar
 * date, and the first thing staff see must not imply a pickup time nobody
 * agreed to.
 */
function formatChipTime(appointment: Pick<Appointment, 'startAt' | 'timezone' | 'appointmentType'>): string {
  if (isExpectedCremainsPickup(appointment)) return 'All day';
  return formatClockTime(appointment.startAt, appointment.timezone);
}

/** Hour + a/p suffix, minutes only when non-zero ("9a", "1:30p"), in the
    appointment's own timezone — §2.4's week-chip time format. */
function formatClockTime(isoString: string, timezone: string): string {
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

  /** Month is the default view (2026-10): staff open the calendar to see
      the shape of the month — which Tuesdays and Fridays carry cremains
      pickups, where services cluster — not a flat list. Held in component
      state with no persistence, so navigating away and back, or
      refreshing, returns to Month every time. Day/Week/Agenda remain fully
      available and unchanged, and `effectiveView` below still substitutes
      Agenda on narrow viewports. */
  const [view, setView] = useState<CalendarView>('month');
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
  /** Only cases this caller is authorized to see — `useCases()` is already
      organization-scoped, so a stale or cross-tenant caseId simply fails
      the lookup and the chip falls back to a neutral label. */
  const caseById = useMemo(() => {
    const map = new Map<string, { caseNumber: string; decedentName: string }>();
    for (const c of casesQuery.data ?? []) map.set(c.id, { caseNumber: c.caseNumber, decedentName: c.decedentName });
    return map;
  }, [casesQuery.data]);
  const caseNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, c] of caseById) map.set(id, c.decedentName);
    return map;
  }, [caseById]);

  /** The organization's own calendar day drives the derived Overdue
      colour — never the viewer's device. Taken from an appointment's own
      stored timezone, so no extra request is needed. */
  const organizationToday = useMemo(() => {
    const tz = (appointmentsQuery.data ?? []).find((a) => a.timezone)?.timezone;
    return organizationLocalDate(new Date().toISOString(), tz) ?? '';
  }, [appointmentsQuery.data]);

  /** The pickup whose details are open, if any. */
  const [detailAppointment, setDetailAppointment] = useState<Appointment | null>(null);

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
    const category = eventCategory(appointment, organizationToday);
    const isPickup = isExpectedCremainsPickup(appointment);
    return (
      <div key={appointment.id} className="sx-agenda-row" data-event={category} data-terminal={isTerminal || undefined}>
        <span className="sx-agenda-time">
          {/* An expected cremains pickup is an ALL-DAY calendar date, not a
              wall-clock moment — rendering its anchor instants would show an
              invented pickup time. Every other event type is unchanged. */}
          {isExpectedCremainsPickup(appointment)
            ? 'All day'
            : `${formatAppointmentTime(appointment.startAt, appointment.timezone)}–${formatAppointmentTime(appointment.endAt, appointment.timezone)}`}
        </span>
        <div>
          {isPickup ? (
            <button
              type="button"
              className={styles.agendaTitleButton}
              onClick={() => setDetailAppointment(appointment)}
            >
              {chipLabel(appointment, appointment.caseId ? caseById.get(appointment.caseId) : undefined, false)}
            </button>
          ) : (
            <div className="sx-agenda-title">{appointment.title}</div>
          )}
          <div className="sx-agenda-meta">
            {typeLabel}
            {caseName ? ` · ${toDisplayName(caseName)}` : ''}
          </div>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`sx-status ${statusModifier(appointmentStatusVariant(appointment.status))}`}>
            {isPickup ? EVENT_CATEGORY_LABEL[category] : APPOINTMENT_STATUS_LABEL[appointment.status]}
          </span>
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
                    const category = eventCategory(a, organizationToday);
                    const isPickup = isExpectedCremainsPickup(a);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className="sx-chip"
                        data-status={a.status}
                        data-event={category}
                        data-terminal={isTerminal || undefined}
                        title={`${a.title} — ${EVENT_CATEGORY_LABEL[category]}`}
                        onClick={() => {
                          if (isPickup) {
                            setDetailAppointment(a);
                            return;
                          }
                          setAnchor(day);
                          setView('day');
                        }}
                      >
                        {!isExpectedCremainsPickup(a) && <span className="sx-chip-time">{formatChipTime(a)}</span>}
                        {chipLabel(a, a.caseId ? caseById.get(a.caseId) : undefined, false)}
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
            // Overdue pickups surface first so a busy cell never hides the
            // one that needs attention; everything else keeps start order,
            // and nothing is filtered out.
            const dayAppointments = appointments
              .filter((a) => isSameDay(new Date(a.startAt), day))
              .sort((a, b) => {
                const rank = (x: Appointment) => (eventCategory(x, organizationToday) === 'pickup-overdue' ? 0 : 1);
                return rank(a) - rank(b) || a.startAt.localeCompare(b.startAt);
              });
            const isOutsideMonth = day.getMonth() !== currentMonth;
            return (
              <div key={day.toISOString()} className="sx-month-cell" data-outside={isOutsideMonth || undefined} data-today={isSameDay(day, today) || undefined}>
                <button type="button" className="sx-month-day" aria-label={day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} onClick={() => { setAnchor(day); setView('day'); }}>
                  {day.getDate()}
                </button>
                {dayAppointments.slice(0, 2).map((a) => {
                  const isTerminal = isTerminalAppointmentStatus(a.status);
                  const category = eventCategory(a, organizationToday);
                  const isPickup = isExpectedCremainsPickup(a);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className="sx-chip"
                      data-status={a.status}
                      data-event={category}
                      data-terminal={isTerminal || undefined}
                      title={`${a.title} — ${EVENT_CATEGORY_LABEL[category]}`}
                      onClick={() => {
                        if (isPickup) {
                          setDetailAppointment(a);
                          return;
                        }
                        setAnchor(day);
                        setView('day');
                      }}
                    >
                      {!isPickup && <span className="sx-chip-time">{formatChipTime(a)}</span>}
                      {chipLabel(a, a.caseId ? caseById.get(a.caseId) : undefined, true)}
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

      {/* Informational only — it never filters anything, and sits beside
          the existing Event type / Resource filters rather than replacing
          them. Each entry names its status in TEXT as well as colour, so
          colour is never the only way to read the calendar. */}
      <ul className={styles.legend} aria-label="Calendar colour key">
        {(Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[]).map((category) => (
          <li key={category} className={styles.legendItem}>
            <span className={styles.legendSwatch} data-event={category} aria-hidden="true" />
            {EVENT_CATEGORY_LABEL[category]}
          </li>
        ))}
      </ul>

      {effectiveView === 'agenda' && renderAgenda(appointments, 'No appointments in this window.')}
      {effectiveView === 'day' && renderDay()}
      {effectiveView === 'week' && renderWeek()}
      {effectiveView === 'month' && renderMonth()}

      {detailAppointment && (() => {
        const case_ = detailAppointment.caseId ? caseById.get(detailAppointment.caseId) : undefined;
        const expected = expectedDateOf(detailAppointment);
        const status = resolvePickupStatus(detailAppointment, organizationToday);
        const paperwork = paperworkDateFromNotes(detailAppointment.notes);
        const received = status === 'received';
        return (
          <Modal open onClose={() => setDetailAppointment(null)} title="Expected Cremains Pickup" size="lg">
            <div className="sx-modal-header">
              <h2 className="sx-modal-title">Expected Cremains Pickup</h2>
              <button type="button" className="sx-icon-btn" aria-label="Close" onClick={() => setDetailAppointment(null)}>
                ×
              </button>
            </div>
            <div className="sx-modal-body">
              <dl className={styles.detailGrid}>
                <div>
                  <dt className="sx-label">Case</dt>
                  <dd className={styles.detailValue}>{case_?.caseNumber ?? 'Not available'}</dd>
                </div>
                <div>
                  <dt className="sx-label">Deceased</dt>
                  <dd className={styles.detailValue}>{case_ ? toDisplayName(case_.decedentName) : 'Not available'}</dd>
                </div>
                <div>
                  <dt className="sx-label">Expected pickup</dt>
                  <dd className={styles.detailValue}>{expected ? formatPickupDate(expected) : 'Not scheduled'}</dd>
                </div>
                <div>
                  <dt className="sx-label">Status</dt>
                  <dd className={styles.detailValue}>{PICKUP_STATUS_LABEL[status]}</dd>
                </div>
                <div>
                  <dt className="sx-label">Paperwork sent</dt>
                  {/* Never guessed — a staff-entered pickup records no
                      paperwork date at all. */}
                  <dd className={styles.detailValue}>{paperwork ? formatPickupDate(paperwork) : 'Not recorded'}</dd>
                </div>
                <div>
                  <dt className="sx-label">Actual receipt</dt>
                  <dd className={styles.detailValue}>
                    {received && expected ? formatPickupDate(expected) : 'Not received'}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="sx-modal-footer">
              <button type="button" className="sx-btn sx-btn-secondary" onClick={() => setDetailAppointment(null)}>
                Close
              </button>
              {/* Navigates by canonical case id, and only when the case
                  resolved through this organization's own case list. */}
              {detailAppointment.caseId && case_ && (
                <Link className="sx-btn sx-btn-primary" href={`/cases/${detailAppointment.caseId}`}>
                  Open Case
                </Link>
              )}
            </div>
          </Modal>
        );
      })()}

      <AppointmentDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} organizationId={organizationId} defaultStartAt={anchor.toISOString()} />
    </div>
  );
}
