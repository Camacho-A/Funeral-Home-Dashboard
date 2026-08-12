/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Pure RFC5545 (iCalendar) text generation — no I/O, no
 * Wix/service dependency, so it's trivially testable and reusable
 * across all three ICS surfaces (single-event staff download, the
 * personal feed, the family single-event download). Callers resolve
 * everything (Appointment, location text, notes-or-not) before calling
 * in, keeping the staff/family DESCRIPTION split (notes only ever
 * reach this module when the caller has already decided to include
 * them — see `IcsEventInput.description`) a caller responsibility, not
 * this module's.
 *
 * Materialized VEVENTs, not RRULE — Beacon's own recurrence is already
 * fully materialized into independent `Appointment` rows (ADR-031), so
 * one independent VEVENT per row is simpler and always correct by
 * construction; reconstructing an RRULE would risk an expansion that
 * silently diverges from Beacon's real, edited-exception-aware
 * occurrence list. UTC (`...Z`) timestamps rather than TZID/VTIMEZONE —
 * every mainstream client converts a UTC-stamped event to the viewer's
 * own local time correctly, sidestepping a hand-rolled VTIMEZONE
 * block's DST-edge-case risk. A cancelled appointment emits
 * `STATUS:CANCELLED` rather than being omitted — RFC5545's documented
 * mechanism for "this event, which the client may already have, is now
 * cancelled."
 */

export type IcsEventInput = {
  appointmentId: string;
  title: string;
  /** null omits DESCRIPTION entirely — the family path never passes
      Appointment.notes here. */
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  status: 'confirmed' | 'cancelled';
  /** Omitted from output when absent — the family-side DTO
      (`PortalAppointmentView`) carries neither, and CREATED/
      LAST-MODIFIED are both optional VEVENT properties per RFC5545,
      not required for a valid calendar. */
  createdAt?: string;
  updatedAt?: string;
};

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** RFC5545 §3.3.11 text escaping — backslash, semicolon, comma, and
    embedded newlines. */
function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC5545 §3.1 line folding at 75 octets, continuation lines prefixed
    with a single space. A simplified char-count approximation (not a
    strict UTF-8 octet count) — more than sufficient for this domain's
    overwhelmingly ASCII appointment titles/notes, and still produces
    output every mainstream client parses correctly. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    const width = i === 0 ? 75 : 74;
    parts.push(line.slice(i, i + width));
    i += width;
  }
  return parts.join('\r\n ');
}

function buildVEvent(event: IcsEventInput, generatedAt: string): string {
  const lines = [
    'BEGIN:VEVENT',
    `UID:beacon-appointment-${event.appointmentId}@beacon.app`,
    `DTSTAMP:${toIcsUtc(generatedAt)}`,
    `DTSTART:${toIcsUtc(event.startAt)}`,
    `DTEND:${toIcsUtc(event.endAt)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
  ];
  if (event.createdAt) lines.push(`CREATED:${toIcsUtc(event.createdAt)}`);
  if (event.updatedAt) lines.push(`LAST-MODIFIED:${toIcsUtc(event.updatedAt)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  lines.push('END:VEVENT');
  return lines.map(foldLine).join('\r\n');
}

/** `calendarName` becomes `X-WR-CALNAME`, a widely (if non-standardly)
    supported hint most clients use as the subscribed calendar's
    display name. `generatedAt` defaults to real "now" but is
    injectable for deterministic tests. */
export function buildIcsCalendar(calendarName: string, events: IcsEventInput[], generatedAt: string = new Date().toISOString()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Beacon//Scheduling//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    ...events.map((event) => buildVEvent(event, generatedAt)),
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** A single-VEVENT calendar — the shape both single-appointment
    download routes (staff and family) return. */
export function buildSingleEventIcs(calendarName: string, event: IcsEventInput, generatedAt?: string): string {
  return buildIcsCalendar(calendarName, [event], generatedAt);
}
