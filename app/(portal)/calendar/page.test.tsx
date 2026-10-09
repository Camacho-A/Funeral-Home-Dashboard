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
  appointment({ id: 'a-1', title: 'Viewing A' }),
  appointment({ id: 'a-2', title: 'Viewing B' }),
  appointment({ id: 'a-3', title: 'Viewing C' }),
];

vi.mock('@/hooks/useRbac', () => ({
  useMyPermissions: () => ({ isSuccess: true, data: { permissions: ['schedule.create', 'schedule.read'] } }),
}));
vi.mock('@/hooks/useResources', () => ({ useResources: () => ({ data: [] }) }));
vi.mock('@/hooks/useCalendarIntegrations', () => ({ useCalendarSyncLinks: () => ({ data: [] }) }));
vi.mock('@/hooks/useCases', () => ({ useCases: () => ({ data: [{ id: 'case-1', caseNumber: 'B2026-040', decedentName: 'WALTER BOONE' }] }) }));
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
    for (const chip of screen.getAllByRole('button')) {
      const text = chip.textContent ?? '';
      if (/·/.test(text) && /\d{3}/.test(text)) expect(text).toContain('040');
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

  it('says "Not recorded" and "Not received" rather than inventing dates', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: /040 · Boone/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Not recorded')).toBeInTheDocument();
    expect(within(dialog).getByText('Not received')).toBeInTheDocument();
  });

  it('links to the case by canonical id', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: /040 · Boone/ }));
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Open Case' })).toHaveAttribute('href', '/cases/case-1');
  });
});
