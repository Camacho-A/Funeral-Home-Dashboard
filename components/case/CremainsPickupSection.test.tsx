import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
  function openAdd() {
    renderSection([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add Expected Pickup' }));
  }

  /** The section's own trigger shares this name, so submit lookups are
      scoped inside the dialog. */
  const submitButton = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Expected Pickup' });

  it('opens a properly-labelled dialog with a title and description', () => {
    openAdd();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add Expected Cremains Pickup' })).toBeInTheDocument();
    expect(screen.getByText(/Set the date the cremains are expected to be ready/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('derives the pickup-day panel from the organization\'s own configuration', () => {
    openAdd();
    expect(screen.getByText('Pickup days')).toBeInTheDocument();
    expect(screen.getByText('Cremains are typically available for pickup on Tuesday and Friday.')).toBeInTheDocument();
  });

  it('gives the date a required label and helper text', () => {
    openAdd();
    expect(screen.getByLabelText(/Expected Pickup Date/)).toBeInTheDocument();
    expect(screen.getByText('Select the expected date the cremains will be available.')).toBeInTheDocument();
  });

  it('offers a multiline notes field with a helpful placeholder', () => {
    openAdd();
    const notes = screen.getByLabelText('Notes (optional)');
    expect(notes.tagName).toBe('TEXTAREA');
    expect(notes).toHaveAttribute('placeholder', 'Add any notes about this pickup...');
  });

  it('shows no warning panels until they actually apply', () => {
    openAdd();
    expect(screen.queryByText(/falls outside your usual pickup schedule/)).not.toBeInTheDocument();
    expect(screen.queryByText(/in the past/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
  });

  it('disables the primary action until a date is chosen', () => {
    openAdd();
    expect(submitButton()).toBeDisabled();
  });

  it('requires a reason for an off-schedule date, and never silently shifts it', () => {
    openAdd();
    // 2026-10-14 is a Wednesday.
    fireEvent.change(screen.getByLabelText(/Expected Pickup Date/), { target: { value: '2026-10-14' } });

    expect(screen.getByText(/is a Wednesday, which falls outside your usual pickup schedule/)).toBeInTheDocument();
    const submit = submitButton();
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'crematory called' } });
    expect(submit).toBeEnabled();
  });

  it('accepts an on-schedule date with no reason required', () => {
    openAdd();
    // 2026-10-16 is a Friday.
    fireEvent.change(screen.getByLabelText(/Expected Pickup Date/), { target: { value: '2026-10-16' } });
    expect(screen.queryByText(/falls outside your usual pickup schedule/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it('warns about a historical date but still allows it', () => {
    openAdd();
    // A past Friday — exactly the B2026-035 situation staff will hit.
    fireEvent.change(screen.getByLabelText(/Expected Pickup Date/), { target: { value: '2020-01-03' } });
    expect(screen.getByText('This date is in the past. It will be saved as entered.')).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it('closes without saving from Cancel', () => {
    openAdd();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('CremainsPickupSection — Edit Expected Date dialog', () => {
  function openEdit() {
    renderSection([pickup()]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Date' }));
  }

  /** The section behind the modal also renders an "Expected pickup" label,
      so field lookups are scoped inside the dialog. */
  const dateField = () => within(screen.getByRole('dialog')).getByLabelText(/Expected Pickup Date/);

  it('uses the same redesigned shell, pre-filled with the current date', () => {
    openEdit();
    expect(screen.getByRole('heading', { name: 'Edit Expected Pickup Date' })).toBeInTheDocument();
    expect(screen.getByText('Pickup days')).toBeInTheDocument();
    expect(dateField()).toHaveValue('2099-10-16');
    expect(screen.getByRole('button', { name: 'Save Date' })).toBeInTheDocument();
  });

  it('omits the notes field, which only applies when creating', () => {
    openEdit();
    expect(screen.queryByLabelText('Notes (optional)')).not.toBeInTheDocument();
  });

  it('applies the same off-schedule rule when re-dating', () => {
    openEdit();
    fireEvent.change(dateField(), { target: { value: '2026-10-14' } });
    expect(screen.getByText(/falls outside your usual pickup schedule/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Date' })).toBeDisabled();
  });
});

describe('CremainsPickupSection — multi-tenant', () => {
  it('an organization with no cremains configuration still renders, with no invented schedule', () => {
    renderSection([], { organizationId: SECOND_MOCK_ORGANIZATION_ID });
    fireEvent.click(screen.getByRole('button', { name: 'Add Expected Pickup' }));
    // Falls back to the disabled default's weekdays rather than inheriting
    // Manors' Tuesday/Friday as if it were a platform rule.
    expect(screen.getByText('Pickup days')).toBeInTheDocument();
    expect(screen.getByText(/Cremains are typically available for pickup on/)).toBeInTheDocument();
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

/**
 * Error presentation (2026-10). The production failure surfaced only as
 * "Could not save the expected pickup." — true but useless. Staff now get
 * a message tied to what actually happened.
 */
describe('CremainsPickupSection — error messages', () => {
  function openAddWith(status: number, message: string) {
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    renderSection([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add Expected Pickup' }));
    fireEvent.change(screen.getByLabelText(/Expected Pickup Date/), { target: { value: '2026-10-16' } });
    return () => {
      global.fetch = originalFetch;
    };
  }

  it('explains a permission failure in plain language', async () => {
    const restore = openAddWith(403, 'Not authorized to schedule for this organization.');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Expected Pickup' }));
    expect(await screen.findByText('You do not have permission to schedule this pickup.')).toBeInTheDocument();
    restore();
  });

  it('explains a duplicate and points at editing', async () => {
    const restore = openAddWith(409, 'This case already has an expected cremains pickup.');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Expected Pickup' }));
    expect(await screen.findByText(/already exists for this case/)).toBeInTheDocument();
    restore();
  });

  it('never leaks a server error, and keeps the entered values for a retry', async () => {
    const restore = openAddWith(500, 'TypeError: Failed to parse URL from /api/cases/x');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Expected Pickup' }));
    expect(await screen.findByText('The selected date could not be saved. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to parse URL/)).not.toBeInTheDocument();
    // The dialog stays open with the date still entered, so staff can retry.
    expect(screen.getByLabelText(/Expected Pickup Date/)).toHaveValue('2026-10-16');
    restore();
  });
});
