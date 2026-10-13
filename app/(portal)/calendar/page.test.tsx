import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { allDayWindowFor } from '@/domain/scheduling/cremainsPickupPresentation';
import type { Appointment } from '@/types/appointment';

/**
 * Calendar default view (2026-10). The page is a pure client-side
 * projection of one appointments query, so these mock the hooks that feed
 * it and exercise the real component.
 */
const TZ = 'America/New_York';
const MONTH_ANCHOR = new Date('2026-10-15T12:00:00.000Z');

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    appointmentType: 'viewing',
    title: 'Viewing',
    notes: null,
    locationId: null,
    status: 'scheduled',
    startAt: '2026-10-16T18:00:00.000Z',
    endAt: '2026-10-16T19:00:00.000Z',
    timezone: TZ,
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: null,
    createdBy: 'u',
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: 'c',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const APPOINTMENTS: Appointment[] = [
  appointment({
    id: 'cremains-pickup-case-9',
    appointmentType: 'cremains.pickup.expected',
    title: 'Expected Cremains Pickup — B2026-040',
    ...allDayWindowFor('2026-10-16', TZ),
  }),
  appointment({
    id: 'cremains-pickup-archived',
    caseId: 'case-archived',
    appointmentType: 'cremains.pickup.expected',
    title: 'Expected Cremains Pickup — B2026-035',
    ...allDayWindowFor('2026-10-17', TZ),
  }),
  appointment({ id: 'a-1', title: 'Viewing A' }),
  appointment({ id: 'a-2', title: 'Viewing B' }),
  appointment({ id: 'a-3', title: 'Viewing C' }),
];

vi.mock('@/hooks/useRbac', () => ({
  useMyPermissions: () => ({ isSuccess: true, data: { permissions: ['schedule.create', 'schedule.read'] } }),
}));
vi.mock('@/hooks/useResources', () => ({ useResources: () => ({ data: [] }) }));
vi.mock('@/hooks/useCalendarIntegrations', () => ({ useCalendarSyncLinks: () => ({ data: [] }) }));
/** Captures the filters the page asks for, so the archived-case
    regression can assert the calendar looks cases up historically. */
const useCasesSpy = vi.fn();
vi.mock('@/hooks/useCases', () => ({
  useCases: (filters?: unknown) => {
    useCasesSpy(filters);
    return {
      data: [
        { id: 'case-1', caseNumber: 'B2026-040', decedentName: 'WALTER BOONE', dateOfDeath: '10/09/2026' },
        // Archived — a filed case is still the subject of its own past
        // events. Deliberately carries NO date of death, so the popup's
        // "Not recorded" path is exercised on a real case rather than on
        // a missing one.
        { id: 'case-archived', caseNumber: 'B2026-035', decedentName: 'EVARISTA SILVA RIVERO', isDeleted: true, dateOfDeath: '' },
      ],
    };
  },
}));
vi.mock('@/hooks/useAppointments', () => ({ useAppointments: () => ({ data: APPOINTMENTS, isPending: false, isError: false }) }));
// Wide viewport, so `effectiveView` never substitutes Agenda.
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('@/components/scheduling/AppointmentDialog', () => ({ AppointmentDialog: () => null }));

const { default: CalendarPage } = await import('./page');

function renderCalendar() {
  return render(
    <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
      <CalendarPage />
    </OrganizationProvider>,
  );
}

/** The view switcher is a tablist; the selected tab carries aria-selected. */
function selectedView(): string | null {
  const tabs = screen.getAllByRole('tab');
  return tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.textContent?.trim() ?? null;
}

describe('Calendar — default view', () => {
  it('opens on Month', () => {
    renderCalendar();
    expect(selectedView()).toBe('Month');
  });

  it('returns to Month after navigating away and back', () => {
    const { unmount } = renderCalendar();
    // Switch to Week, then leave the page entirely.
    fireEvent.click(screen.getAllByRole('tab').find((t) => t.textContent?.trim() === 'Week')!);
    expect(selectedView()).toBe('Week');
    unmount();

    renderCalendar();
    expect(selectedView()).toBe('Month');
  });

  it('returns to Month on a refresh — the view is never persisted anywhere', () => {
    // A refresh is a fresh mount, so this holds as long as the view is not
    // written to storage or the URL. Asserted structurally, because a
    // persisted view would survive the remount above and silently defeat
    // the default.
    const source = fs.readFileSync(path.join(process.cwd(), 'app/(portal)/calendar/page.tsx'), 'utf8');
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/useSearchParams|router\.replace/);
    renderCalendar();
    expect(selectedView()).toBe('Month');
  });

  it('keeps Day, Week and Agenda available and switchable', () => {
    renderCalendar();
    for (const label of ['Day', 'Week', 'Month', 'Agenda']) {
      expect(screen.getAllByRole('tab').some((t) => t.textContent?.trim() === label), label).toBe(true);
    }
    fireEvent.click(screen.getAllByRole('tab').find((t) => t.textContent?.trim() === 'Week')!);
    expect(selectedView()).toBe('Week');
  });
});

describe('Calendar — Month view content', () => {
  it('shows several events on one day, with an overflow affordance', () => {
    renderCalendar();
    // Four appointments share 2026-10-16; the cell shows two chips plus a
    // "+N more" control rather than silently hiding the rest.
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('preserves the Cremains Pickups filter', () => {
    renderCalendar();
    const typeSelect = screen.getAllByRole('combobox').find((s) => within(s).queryByText(/Cremains Pickups/));
    expect(typeSelect).toBeDefined();
    expect(within(typeSelect!).getByText(/Cremains Pickups/)).toBeInTheDocument();
  });
});

describe('Calendar — cremains pickup chips', () => {
  /** The pickup chip, found by its compact case label. */
  const pickupChip = () => screen.getByRole('button', { name: /040 · Boone/ });

  it('labels a pickup with its case number and surname, compactly in month cells', () => {
    renderCalendar();
    expect(pickupChip()).toBeInTheDocument();
  });

  it('shows neither "All day" nor a clock time on a pickup chip', () => {
    renderCalendar();
    const chip = pickupChip();
    expect(chip.textContent).not.toMatch(/all day/i);
    expect(chip.textContent).not.toMatch(/\d{1,2}:?\d{0,2}\s?[ap]m?\b/i);
  });

  it('colours the pickup as expected/in-progress, and names the status in text too', () => {
    renderCalendar();
    const chip = pickupChip();
    expect(chip).toHaveAttribute('data-event', 'pickup-expected');
    // Colour is never the only signal.
    expect(chip.getAttribute('title')).toContain('Expected Pickup');
  });

  it('keeps a regular appointment visually distinct, and still shows its time', () => {
    renderCalendar();
    const viewing = screen.getAllByRole('button').find((b) => b.textContent?.includes('Viewing A'))!;
    expect(viewing).toHaveAttribute('data-event', 'appointment');
    expect(viewing.textContent).toMatch(/\d/);
  });

  it('never invents a case number when the case is not available to this caller', () => {
    renderCalendar();
    // Every rendered chip label is either a real appointment title or a
    // label built from a case this organization can actually see.
    // Both mocked cases are real, visible ones; a chip must never show a
    // number belonging to neither.
    const visibleCaseNumbers = ['040', '035'];
    for (const chip of screen.getAllByRole('button')) {
      const text = chip.textContent ?? '';
      if (/·/.test(text) && /\d{3}/.test(text)) {
        expect(visibleCaseNumbers.some((number) => text.includes(number)), text).toBe(true);
      }
    }
  });
});

describe('Calendar — colour legend', () => {
  it('names every status in text beside its swatch', () => {
    renderCalendar();
    const legend = screen.getByRole('list', { name: 'Calendar colour key' });
    for (const label of ['Expected Pickup', 'Received', 'Overdue', 'Appointments']) {
      expect(within(legend).getByText(label), label).toBeInTheDocument();
    }
  });

  it('is informational only — it does not replace the filters', () => {
    renderCalendar();
    expect(screen.getByRole('list', { name: 'Calendar colour key' })).toBeInTheDocument();
    expect(screen.getAllByRole('combobox').some((s) => within(s).queryByText(/Cremains Pickups/))).toBe(true);
  });
});

describe('Calendar — pickup details', () => {
  it('opens a details panel showing the full case number and status', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: /040 · Boone/ }));
    const dialog = screen.getByRole('dialog');
    // The compact chip label never loses the real case number.
    expect(within(dialog).getByText('B2026-040')).toBeInTheDocument();
    expect(within(dialog).getByText('Walter Boone')).toBeInTheDocument();
    expect(within(dialog).getByText('Friday, October 16, 2026')).toBeInTheDocument();
    // The panel names the precise status (Estimated vs Confirmed), which
    // the legend deliberately collapses into one "Expected Pickup" colour.
    expect(within(dialog).getByText('Estimated')).toBeInTheDocument();
  });

  it('says "Not received" rather than inventing a receipt date', () => {
    // The companion "Not recorded" assertion moved to the Date of Death
    // suite below, which is the row that now carries it.
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: /040 · Boone/ }));
    expect(within(screen.getByRole('dialog')).getByText('Not received')).toBeInTheDocument();
  });

  it('links to the case by canonical id', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: /040 · Boone/ }));
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Open Case' })).toHaveAttribute('href', '/cases/case-1');
  });
});

/**
 * Date of Death replaces Paperwork sent (2026-10).
 *
 * The paperwork date is an internal automation artefact; the date of
 * death is what staff actually need when they open a pickup event. The
 * appointment's own paperwork note is untouched — it is simply no longer
 * what this row shows.
 */
describe('Calendar — pickup details show Date of Death', () => {
  it('shows the case\'s date of death in the same long form as the other dates', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: /040 · Boone/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Date of Death')).toBeInTheDocument();
    expect(within(dialog).getByText('Friday, October 9, 2026')).toBeInTheDocument();
  });

  it('no longer shows a Paperwork sent row', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: /040 · Boone/ }));
    expect(within(screen.getByRole('dialog')).queryByText('Paperwork sent')).not.toBeInTheDocument();
  });

  it('reads "Not recorded" rather than inventing a date', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: /035 · Rivero/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Date of Death')).toBeInTheDocument();
    expect(within(dialog).getByText('Not recorded')).toBeInTheDocument();
  });

  it('works for an archived case, which keeps its full event details', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: /035 · Rivero/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('B2026-035')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open Case' })).toHaveAttribute('href', '/cases/case-archived');
  });

  it('leaves every other row in the popup intact', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: /040 · Boone/ }));
    const dialog = screen.getByRole('dialog');
    for (const label of ['Case', 'Deceased', 'Expected pickup', 'Status', 'Actual receipt']) {
      expect(within(dialog).getByText(label), label).toBeInTheDocument();
    }
  });
});

describe('Calendar — archived cases keep their event details (2026-10)', () => {
  it('looks cases up across the whole history, not just the active list', () => {
    // Root cause of "Case: Not available / Deceased: Not available": the
    // calendar enriched its events from the ACTIVE case list, so archiving
    // a case silently blanked its own past events. The information was
    // never lost — the lookup just stopped returning it.
    renderCalendar();
    expect(useCasesSpy).toHaveBeenCalledWith({ scope: 'all' });
  });
});
