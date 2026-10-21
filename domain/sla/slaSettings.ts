import { getRegisteredOrganizationProfile } from '../organization/organizationProfiles';
import { isBusinessDay, localDateTime, parseClockTime, toLocalDate, type BusinessCalendar } from './businessCalendar';

/**
 * SLA settings (2026-10). Organization-scoped: an organization's profile
 * decides whether SLA tracking exists at all (Manors only), and its
 * Organization record may override the defaults below through the admin
 * settings page (`Organization.slaSettings`). Anything invalid in a stored
 * value falls back to the default rather than breaking the calendar.
 */
export type SlaTargets = {
  /** Case received → EDRS entry. */
  edrsEntry: number;
  /** EDRS submitted to the doctor → attestation received. */
  doctorAttestation: number;
  /** Attestation received → Hard Save. 0 = the same business day. */
  hardSave: number;
  /** Submitted for approval → approval. */
  approval: number;
  /** Crematory receipt → cremains ready. */
  crematoryTurnaround: number;
  /** Cremains ready → family pickup. Advisory only. */
  familyPickup: number;
};

export type SlaSettings = {
  enabled: boolean;
  timezone: string;
  /** HH:MM — the end of the business day; a deadline is this time on its date. */
  closingTime: string;
  /** HH:MM — an event at or after this time counts from the next business day. */
  afterHoursCutoff: string;
  /** YYYY-MM-DD dates that are not business days. */
  holidays: string[];
  targets: SlaTargets;
  /** Weekdays (0 = Sunday … 6 = Saturday) the crematory returns cremains on,
      when it works to a fixed weekly schedule. Empty = any business day. */
  crematoryReturnWeekdays: number[];
  /** A deadline this many business days away (or fewer) is "Due soon". */
  dueSoonBusinessDays: number;
  /** HH:MM local times the scheduled SLA alert check runs on business days
      (it acts only within the hour starting at each). */
  alertTimes: string[];
  notifications: {
    /** Staff deadlines approaching (due soon / due today). */
    approaching: boolean;
    /** Staff deadlines overdue. */
    overdue: boolean;
    /** External parties (doctor, state, crematory) past their target. */
    external: boolean;
  };
};

export const DEFAULT_SLA_SETTINGS: Readonly<SlaSettings> = Object.freeze({
  enabled: false,
  timezone: 'America/New_York',
  closingTime: '17:00',
  afterHoursCutoff: '17:00',
  holidays: [],
  targets: { edrsEntry: 2, doctorAttestation: 4, hardSave: 0, approval: 2, crematoryTurnaround: 5, familyPickup: 5 },
  crematoryReturnWeekdays: [],
  dueSoonBusinessDays: 1,
  alertTimes: ['09:00', '15:00'],
  notifications: { approaching: true, overdue: true, external: true },
});

/** Whether this organization has SLA tracking at all (its profile). */
export function isSlaTrackingEnabled(organizationId: string | null | undefined): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.slaTracking;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const wholeNumber = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
const clock = (value: unknown, fallback: string): string => (typeof value === 'string' && parseClockTime(value) !== null ? value.trim() : fallback);
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Validates a stored or submitted settings object against the defaults. */
export function normalizeSlaSettings(raw: unknown, enabled: boolean): SlaSettings {
  const d = DEFAULT_SLA_SETTINGS;
  const r = isRecord(raw) ? raw : {};
  const t = isRecord(r.targets) ? r.targets : {};
  const n = isRecord(r.notifications) ? r.notifications : {};
  const holidays = Array.isArray(r.holidays)
    ? [...new Set(r.holidays.map((h) => (typeof h === 'string' ? toLocalDate(h) : null)).filter((h): h is string => h !== null))].sort()
    : [...d.holidays];
  const weekdays = Array.isArray(r.crematoryReturnWeekdays)
    ? [...new Set(r.crematoryReturnWeekdays.filter((w): w is number => Number.isInteger(w) && w >= 0 && w <= 6))].sort()
    : [...d.crematoryReturnWeekdays];
  return {
    enabled,
    timezone: typeof r.timezone === 'string' && isValidTimezone(r.timezone) ? r.timezone : d.timezone,
    closingTime: clock(r.closingTime, d.closingTime),
    afterHoursCutoff: clock(r.afterHoursCutoff, d.afterHoursCutoff),
    holidays,
    targets: {
      edrsEntry: wholeNumber(t.edrsEntry, 0, 30, d.targets.edrsEntry),
      doctorAttestation: wholeNumber(t.doctorAttestation, 0, 30, d.targets.doctorAttestation),
      hardSave: wholeNumber(t.hardSave, 0, 30, d.targets.hardSave),
      approval: wholeNumber(t.approval, 0, 30, d.targets.approval),
      crematoryTurnaround: wholeNumber(t.crematoryTurnaround, 0, 30, d.targets.crematoryTurnaround),
      familyPickup: wholeNumber(t.familyPickup, 0, 60, d.targets.familyPickup),
    },
    crematoryReturnWeekdays: weekdays,
    dueSoonBusinessDays: wholeNumber(r.dueSoonBusinessDays, 0, 10, d.dueSoonBusinessDays),
    alertTimes: Array.isArray(r.alertTimes)
      ? (() => {
          const times = [...new Set(r.alertTimes.filter((t): t is string => typeof t === 'string' && parseClockTime(t) !== null).map((t) => t.trim()))].sort();
          return times.length > 0 ? times : [...d.alertTimes];
        })()
      : [...d.alertTimes],
    notifications: {
      approaching: flag(n.approaching, d.notifications.approaching),
      overdue: flag(n.overdue, d.notifications.overdue),
      external: flag(n.external, d.notifications.external),
    },
  };
}

/** The effective settings for an organization: profile switch + record overrides. */
export function resolveSlaSettings(organization: { id: string; slaSettings?: unknown } | null | undefined): SlaSettings {
  const enabled = organization ? isSlaTrackingEnabled(organization.id) : false;
  return normalizeSlaSettings(organization?.slaSettings ?? null, enabled);
}

export function businessCalendarFor(settings: SlaSettings): BusinessCalendar {
  return {
    timezone: settings.timezone,
    closingMinutes: parseClockTime(settings.closingTime) ?? 17 * 60,
    cutoffMinutes: parseClockTime(settings.afterHoursCutoff) ?? 17 * 60,
    holidays: new Set(settings.holidays),
  };
}

/**
 * Whether the scheduled SLA alert check should act now for this
 * organization: a business day (weekends and holidays excluded) and within
 * the hour starting at one of `alertTimes`, in the organization's own
 * timezone. The cron fires at both possible UTC offsets; this keeps exactly
 * one run per window, through daylight saving changes.
 */
export function isSlaAlertRunTime(nowIso: string, settings: SlaSettings): boolean {
  const calendar = businessCalendarFor(settings);
  const now = localDateTime(nowIso, calendar.timezone);
  if (!now || !isBusinessDay(now.date, calendar)) return false;
  return settings.alertTimes.some((time) => {
    const start = parseClockTime(time);
    return start !== null && now.minutes >= start && now.minutes < start + 60;
  });
}
