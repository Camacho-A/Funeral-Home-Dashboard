import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { allDayWindowFor } from '@/domain/scheduling/cremainsPickupPresentation';
import type { Appointment } from '@/types/appointment';
import { CremainsPickupSection, formatPickupDate, paperworkDateFromNotes } from './CremainsPickupSection';

const TZ = 'America/New_York';

function pickup(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'cremains-pickup-case-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    appointmentType: 'cremains.pickup.expected',
    title: 'Expected Cremains Pickup — B2026-040',
    notes: 'AUTOMATICALLY SCHEDULED FROM COMPLETED CREMATORY PAPERWORK ON 2026-10-08.',
    locationId: null,
    status: 'scheduled',
    // Far future so the derived status is never accidentally Overdue, and
    // anchored at the ORGANIZATION's midnight exactly as the service stores it.
    ...allDayWindowFor('2099-10-16', TZ),
    timezone: TZ,
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: null,
    createdBy: 'system',
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: 'c-1',
    createdAt: '2026-10-08T18:00:00.000Z',
    updatedAt: '2026-10-08T18:00:00.000Z',
    ...overrides,
  };
}

const otherAppointment = { ...pickup({ id: 'a-2' }), appointmentType: 'viewing', title: 'Viewing' } as Appointment;

function renderSection(
  appointments: Appointment[],
  opts: { canSchedule?: boolean; organizationId?: string } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={opts.organizationId ?? DEFAULT_ORGANIZATION_ID}>
        <CremainsPickupSection
          caseId="case-1"
          organizationId={opts.organizationId ?? DEFAULT_ORGANIZATION_ID}
          appointments={appointments}
          case_={null}
          canSchedule={opts.canSchedule ?? true}
          organizationTimezone={TZ}
        />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('CremainsPickupSection — empty state', () => {
  it('always shows the section, with a clear empty state and an add action', () => {
    renderSection([otherAppointment]);
    expect(screen.getByText('Cremains Pickup')).toBeInTheDocument();
    expect(screen.getByText('No expected pickup scheduled.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Expected Pickup' })).toBeInTheDocument();
  });

  it('hides the add action from a caller without scheduling permission', () => {
    renderSection([], { canSchedule: false });
    expect(screen.getByText('No expected pickup scheduled.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Expected Pickup' })).not.toBeInTheDocument();
  });
});

describe('CremainsPickupSection — an existing pickup', () => {
  it('shows the expected date, status, paperwork date and receipt state', () => {
    renderSection([otherAppointment, pickup()]);
    expect(screen.getByText('Friday, October 16, 2099')).toBeInTheDocument();
    expect(screen.getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(screen.getByText('Thursday, October 8, 2026')).toBeInTheDocument();
    expect(screen.getByText('Not yet received')).toBeInTheDocument();
    expect(screen.getByText('Automatically calculated')).toBeInTheDocument();
  });

  it('never displays an invented pickup time', () => {
    const { container } = renderSection([pickup()]);
    expect(container.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('offers Edit Date, Confirm Pickup and Mark Received', () => {
    renderSection([pickup()]);
    expect(screen.getByRole('button', { name: 'Edit Date' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Pickup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Received' })).toBeInTheDocument();
  });

  it('offers no actions to a caller without scheduling permission', () => {
    renderSection([pickup()], { canSchedule: false });
    expect(screen.queryByRole('button', { name: 'Edit Date' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark Received' })).not.toBeInTheDocument();
  });

  it('never offers Add when a pickup already exists — editing is the only path', () => {
    renderSection([pickup()]);
    expect(screen.queryByRole('button', { name: 'Add Expected Pickup' })).not.toBeInTheDocument();
  });

  it('drops Confirm once already confirmed, and attributes the date to staff', () => {
    renderSection([pickup({ status: 'confirmed' })]);
    expect(screen.queryByRole('button', { name: 'Confirm Pickup' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
    expect(screen.getByText('Set by staff')).toBeInTheDocument();
  });

  it('shows a staff-entered pickup as having no recorded paperwork date — never a guess', () => {
    renderSection([pickup({ notes: 'Expected pickup entered by staff for 2099-10-16.', lastModifiedBy: 'identity-dana' })]);
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByText('Set by staff')).toBeInTheDocument();
  });

  it('derives Overdue from a past date that was never received, and explains it', () => {
    renderSection([pickup({ ...allDayWindowFor('2020-01-03', TZ) })]);
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0);
    expect(screen.getByText(/expected date has passed/i)).toBeInTheDocument();
  });

  it('switches to Received, drops every action, and keeps the record visible', () => {
    renderSection([pickup({ status: 'completed', ...allDayWindowFor('2020-01-03', TZ) })]);
    expect(screen.getAllByText('Received').length).toBeGreaterThan(0);
    // Shown twice by design once received: as the date and as the actual
    // receipt, which are the same day.
    expect(screen.getAllByText('Friday, January 3, 2020').length).toBe(2);
    expect(screen.queryByRole('button', { name: 'Mark Received' })).not.toBeInTheDocument();
    expect(screen.queryByText(/expected date has passed/i)).not.toBeInTheDocument();
  });
});

describe('CremainsPickupSection — Add Expected Pickup dialog', () => {
  it('states the organization\'s own pickup days', () => {
    renderSection([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add Expected Pickup' }));
    expect(screen.getByRole('dialog', { name: 'Add Expected Pickup' })).toBeInTheDocument();
    expect(screen.getByText('Pickup days are Tuesday and Friday.')).toBeInTheDocument();
  });

  it('requires a reason for an off-schedule date, and never silently shifts it', () => {
    renderSection([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add Expected Pickup' }));
    // 2026-10-14 is a Wednesday.
    fireEvent.change(screen.getByLabelText('Expected pickup date'), { target: { value: '2026-10-14' } });

    expect(screen.getByText(/is a Wednesday, which is not a pickup day/)).toBeInTheDocument();
    expect(screen.getByText(/saved exactly as entered/)).toBeInTheDocument();
    const submit = screen.getAllByRole('button', { name: 'Add Expected Pickup' }).at(-1)!;
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'crematory called' } });
    expect(submit).toBeEnabled();
  });

  it('accepts an on-schedule date with no reason required', () => {
    renderSection([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add Expected Pickup' }));
    // 2026-10-16 is a Friday.
    fireEvent.change(screen.getByLabelText('Expected pickup date'), { target: { value: '2026-10-16' } });
    expect(screen.queryByText(/not a pickup day/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add Expected Pickup' }).at(-1)!).toBeEnabled();
  });

  it('warns about a historical date but still allows it', () => {
    renderSection([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add Expected Pickup' }));
    // A past Friday — exactly the B2026-035 situation staff will hit.
    fireEvent.change(screen.getByLabelText('Expected pickup date'), { target: { value: '2020-01-03' } });
    expect(screen.getByText(/in the past. It will be saved as entered/)).toBeInTheDocument();
  });
});

describe('CremainsPickupSection — multi-tenant', () => {
  it('an organization with no cremains configuration still renders, with no invented schedule', () => {
    renderSection([], { organizationId: SECOND_MOCK_ORGANIZATION_ID });
    fireEvent.click(screen.getByRole('button', { name: 'Add Expected Pickup' }));
    // Falls back to the disabled default's weekdays rather than inheriting
    // Manors' Tuesday/Friday as if it were a platform rule.
    expect(screen.getByText(/^Pickup days are /)).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('formats a local date without any timezone conversion', () => {
    expect(formatPickupDate('2026-10-16')).toBe('Friday, October 16, 2026');
    expect(formatPickupDate('2027-01-01')).toBe('Friday, January 1, 2027');
  });

  it('returns malformed input unchanged rather than guessing', () => {
    expect(formatPickupDate('not-a-date')).toBe('not-a-date');
  });

  it('extracts a paperwork date only from an automatic note', () => {
    expect(paperworkDateFromNotes('AUTOMATICALLY SCHEDULED FROM COMPLETED CREMATORY PAPERWORK ON 2026-10-08.')).toBe('2026-10-08');
    // A staff-entered pickup asserts no paperwork date at all.
    expect(paperworkDateFromNotes('Expected pickup entered by staff for 2026-10-09.')).toBeNull();
    expect(paperworkDateFromNotes(null)).toBeNull();
  });
});
