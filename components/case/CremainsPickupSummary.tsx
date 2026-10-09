'use client';

import type { Appointment } from '@/types/appointment';
import { organizationLocalDate } from '@/domain/scheduling/cremainsPickupSchedule';
import {
  PICKUP_STATUS_LABEL,
  expectedDateOf,
  isExpectedCremainsPickup,
  isManuallyDecided,
  resolvePickupStatus,
  type CremainsPickupStatus,
} from '@/domain/scheduling/cremainsPickupPresentation';

/**
 * Expected Cremains Pickup — the Case Detail summary (2026-10).
 *
 * Deliberately NOT a second set of controls. The Schedule tab already
 * lists this appointment and already offers Confirm / Mark completed /
 * Cancel / reschedule through the existing, permission-gated, audited
 * actions — duplicating them here would create a competing surface for the
 * same operations. This adds only what the generic appointment row cannot
 * express:
 *
 *   - the DERIVED status, including Overdue (which is not an
 *     `AppointmentStatus` and so never appears on the row's own badge)
 *   - the paperwork date the expectation was calculated from
 *   - whether the date is still the automatic calculation or a human's
 *
 * Shows no time of day: an expected pickup is a calendar date, and SOLIS
 * must never display an invented pickup time.
 */

function statusClass(status: CremainsPickupStatus): string {
  if (status === 'received') return 'sx-status-ok';
  if (status === 'overdue') return 'sx-status-bad';
  if (status === 'confirmed') return 'sx-status-info';
  return 'sx-status-plain';
}

/** Formats `YYYY-MM-DD` as a calendar date, with no timezone conversion —
    the string is already the organization's own local date. */
export function formatPickupDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The paperwork date the automation recorded when it scheduled this. */
export function paperworkDateFromNotes(notes: string | null): string | null {
  if (!notes) return null;
  const match = /(\d{4}-\d{2}-\d{2})/.exec(notes);
  return match ? match[1] : null;
}

export function CremainsPickupSummary({ appointments }: { appointments: Appointment[] }) {
  const pickup = appointments.find(isExpectedCremainsPickup);
  if (!pickup) return null;

  const expected = expectedDateOf(pickup);
  if (!expected) return null;

  // "Today" in the ORGANIZATION's timezone, taken from the appointment's
  // own `timezone` (set from the organization when it was scheduled) —
  // never the viewer's device, and without a second network request.
  const organizationToday = organizationLocalDate(new Date().toISOString(), pickup.timezone) ?? '';
  const status = resolvePickupStatus(pickup, organizationToday);
  const paperworkDate = paperworkDateFromNotes(pickup.notes);
  const received = status === 'received';

  return (
    <section className="sx-card" aria-label="Expected cremains pickup" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
        <h3 className="sx-card-title" style={{ margin: 0 }}>
          {received ? 'Cremains Received' : 'Expected Cremains Pickup'}
        </h3>
        <span className={`sx-status ${statusClass(status)}`}>{PICKUP_STATUS_LABEL[status]}</span>
      </div>

      <p style={{ margin: '6px 0 0', fontSize: 18, fontWeight: 600 }}>{formatPickupDate(expected)}</p>

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '10px 18px',
          margin: '12px 0 0',
        }}
      >
        {paperworkDate && (
          <div>
            <dt className="sx-field-label">Paperwork sent</dt>
            <dd style={{ margin: 0 }}>{formatPickupDate(paperworkDate)}</dd>
          </div>
        )}
        <div>
          <dt className="sx-field-label">Date source</dt>
          <dd style={{ margin: 0 }}>
            {isManuallyDecided(pickup) ? 'Set by staff' : 'Automatically calculated'}
          </dd>
        </div>
      </dl>

      {status === 'overdue' && (
        <p className="sx-hint" style={{ marginTop: 10 }} role="status">
          The expected date has passed and the cremains have not been marked received.
        </p>
      )}
      {!received && (
        <p className="sx-hint" style={{ marginTop: 10 }}>
          Confirm the date, change it, or mark the cremains received from this pickup&rsquo;s actions below.
        </p>
      )}
    </section>
  );
}
