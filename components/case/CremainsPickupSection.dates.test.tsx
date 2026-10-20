import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { allDayWindowFor } from '@/domain/scheduling/cremainsPickupPresentation';
import type { Appointment } from '@/types/appointment';
import type { Case } from '@/types/case';
import { CremainsPickupSection } from './CremainsPickupSection';

/**
 * Cremation dates (2026-10). Date of cremation, date received and the
 * expected pickup date are separate. "Mark Received" used to move the
 * expected pickup date onto the receipt date; it now records the receipt
 * date on the case and leaves the expected date alone.
 */
const { updateCaseInfo, updateExpectedDate } = vi.hoisted(() => ({ updateCaseInfo: vi.fn(), updateExpectedDate: vi.fn() }));
vi.mock('@/hooks/useCaseMutations', () => ({ useCaseMutations: () => ({ updateCaseInfo, isPending: false }) }));
vi.mock('@/hooks/useCremainsPickup', () => ({
  useCreateExpectedPickup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateExpectedPickupDate: () => ({ mutateAsync: updateExpectedDate, isPending: false }),
}));

const TZ = 'America/New_York';

function pickup(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'cremains-pickup-case-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    appointmentType: 'cremains.pickup.expected',
    title: 'Expected Cremains Pickup',
    notes: null,
    locationId: null,
    status: 'scheduled',
    ...allDayWindowFor('2026-10-16', TZ),
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
  } as Appointment;
}

function renderSection(appointments: Appointment[], caseOverrides: Partial<Case> = {}) {
  const case_ = { ...caseFixtures[0], id: 'case-1', organizationId: DEFAULT_ORGANIZATION_ID, isDeleted: false, ...caseOverrides } as Case;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <CremainsPickupSection
          caseId="case-1"
          organizationId={DEFAULT_ORGANIZATION_ID}
          appointments={appointments}
          case_={case_}
          canSchedule
          organizationTimezone={TZ}
        />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

/** A grid field's value: the <dd> in the same field as the <dt> label. */
const fieldValue = (label: string) => screen.getByText(label, { selector: 'dt' }).closest('div')!.parentElement!.querySelector('dd');

afterEach(() => vi.clearAllMocks());

describe('CremainsPickupSection — date of cremation, date received, expected pickup are separate', () => {
  it('shows all three, each from its own source', () => {
    renderSection([pickup()], { dateOfCremation: '10/10/2026', cremainsReceivedAt: null });
    expect(fieldValue('Date of Cremation')).toHaveTextContent('Oct');
    expect(fieldValue('Date of Cremation')).toHaveTextContent('10');
    expect(fieldValue('Date Received')).toHaveTextContent('Not yet received');
    expect(fieldValue('Expected Pickup')).toHaveTextContent('16');
  });

  it('records the date of cremation on the case, even before any pickup exists', () => {
    renderSection([], { dateOfCremation: null });
    fireEvent.click(screen.getByRole('button', { name: 'Add date of cremation' }));
    fireEvent.change(screen.getByLabelText('Date of cremation'), { target: { value: '2026-10-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Date' }));
    expect(updateCaseInfo).toHaveBeenCalledWith({ dateOfCremation: '10/09/2026' });
  });

  it('Mark Received records the receipt date on the case and never moves the expected pickup date', () => {
    renderSection([pickup()]);
    fireEvent.click(screen.getByRole('button', { name: 'Mark Received' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Date Received'), { target: { value: '2026-10-14' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark Received' }));

    expect(updateExpectedDate).not.toHaveBeenCalled();
    expect(updateCaseInfo).toHaveBeenCalledTimes(1);
    expect(updateCaseInfo.mock.calls[0][0]).toMatchObject({ cremainsReceivedAt: '10/14/2026' });
    expect(Object.keys(updateCaseInfo.mock.calls[0][0].checklistState)).toHaveLength(1);
  });

  it('a received case with no recorded date says so — it never shows the pickup date', () => {
    renderSection([pickup({ status: 'completed' })], { cremainsReceivedAt: null });
    expect(fieldValue('Date Received')).toHaveTextContent('Received (date not recorded)');
    expect(fieldValue('Date Received')).not.toHaveTextContent('16');
  });

  it('the old checklist workflow (completed pickup, FUTURE expected date, nothing stored) shows no date — B2026-036/038', () => {
    // Exactly how those cases look in Production: received by ticking the
    // checklist, appointment still on its expected date of Oct 23 while
    // "today" is earlier, and no date received on the case.
    renderSection([pickup({ status: 'completed', ...allDayWindowFor('2099-10-23', TZ) })], {
      cremainsReceivedAt: null,
      dateOfCremation: '10/10/2026',
    });
    expect(fieldValue('Date Received')).toHaveTextContent('Received (date not recorded)');
    expect(fieldValue('Date Received')).not.toHaveTextContent('2099');
    expect(fieldValue('Date Received')).not.toHaveTextContent('October 10');
  });

  it('staff can add the real date to such a case, starting from an empty date — never the expected one', () => {
    renderSection([pickup({ status: 'completed' })], { cremainsReceivedAt: null });
    fireEvent.click(screen.getByRole('button', { name: 'Add date received' }));
    expect(screen.getByLabelText('Date received')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Date received'), { target: { value: '2026-10-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Date' }));
    expect(updateCaseInfo).toHaveBeenCalledWith({ cremainsReceivedAt: '10/12/2026' });
    expect(updateExpectedDate).not.toHaveBeenCalled();
  });

  it('an unreceived case reads "Not yet received" and offers no date to edit', () => {
    renderSection([pickup()], { cremainsReceivedAt: null });
    expect(fieldValue('Date Received')).toHaveTextContent('Not yet received');
    expect(screen.queryByRole('button', { name: 'Add date received' })).not.toBeInTheDocument();
  });

  it('a stored date received wins over the pickup date, and can be corrected', () => {
    renderSection([pickup({ status: 'completed' })], { cremainsReceivedAt: '10/15/2026' });
    expect(fieldValue('Date Received')).toHaveTextContent('15');
    fireEvent.click(screen.getByRole('button', { name: 'Edit date received' }));
    fireEvent.change(screen.getByLabelText('Date received'), { target: { value: '2026-10-13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Date' }));
    expect(updateCaseInfo).toHaveBeenCalledWith({ cremainsReceivedAt: '10/13/2026' });
  });

  it('refuses a future date', () => {
    renderSection([], { dateOfCremation: null });
    fireEvent.click(screen.getByRole('button', { name: 'Add date of cremation' }));
    fireEvent.change(screen.getByLabelText('Date of cremation'), { target: { value: '2099-01-01' } });
    expect(screen.getByRole('button', { name: 'Save Date' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('cannot be in the future');
  });

  it('offers no date editing on an archived case', () => {
    renderSection([pickup({ status: 'completed' })], { isDeleted: true, dateOfCremation: null });
    expect(screen.queryByRole('button', { name: /date of cremation|date received/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Add|Edit)/ })).not.toBeInTheDocument();
  });
});

/**
 * Schedule tab redesign (2026-10): one card, a status badge in the header,
 * five fields in a grid, each field's own Add/Edit on its label row, and
 * the date source as secondary text rather than a field of its own.
 */
describe('CremainsPickupSection — redesigned layout', () => {
  const labels = () => Array.from(document.querySelectorAll('dt')).map((dt) => dt.textContent);

  it('shows the five fields in order, and no standalone "Date source" field', () => {
    renderSection([pickup()], { dateOfCremation: '10/10/2026' });
    expect(labels()).toEqual(['Date of Cremation', 'Expected Pickup', 'Date Received', 'Paperwork Sent', 'Status']);
    expect(screen.queryByText('Date source')).not.toBeInTheDocument();
  });

  it('the header badge follows the real pickup status', () => {
    const { unmount } = renderSection([pickup({ status: 'completed' })], { cremainsReceivedAt: '10/15/2026' });
    const heading = screen.getByRole('heading', { name: 'Cremains Pickup' });
    expect(heading.nextElementSibling).toHaveTextContent('Received');
    expect(heading.nextElementSibling).toHaveClass('sx-status-ok');
    unmount();

    renderSection([pickup({ ...allDayWindowFor('2020-01-03', TZ) })]);
    const overdue = screen.getByRole('heading', { name: 'Cremains Pickup' }).nextElementSibling;
    expect(overdue).toHaveTextContent('Overdue');
    expect(overdue).toHaveClass('sx-status-bad');
  });

  it('shows no badge, and "Not scheduled", when there is no pickup', () => {
    renderSection([], {});
    expect(screen.getByRole('heading', { name: 'Cremains Pickup' }).nextElementSibling).toBeNull();
    expect(fieldValue('Expected Pickup')).toHaveTextContent('Not scheduled');
    expect(fieldValue('Status')).toHaveTextContent('Not scheduled');
  });

  it('shows the date source as secondary text under Expected Pickup, with an explanation', () => {
    renderSection([pickup()]);
    const source = within(fieldValue('Expected Pickup') as HTMLElement).getByText('Automatically calculated');
    expect(source).toHaveAttribute('title', expect.stringMatching(/calculated automatically/));
  });

  it('keeps the pickup actions in the header for a pending pickup, and drops them once received', () => {
    const { unmount } = renderSection([pickup()]);
    expect(screen.getByRole('button', { name: 'Confirm Pickup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Received' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit expected pickup date' })).toBeInTheDocument();
    unmount();

    renderSection([pickup({ status: 'completed' })], { cremainsReceivedAt: '10/15/2026' });
    expect(screen.queryByRole('button', { name: 'Mark Received' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit expected pickup date' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit date received' })).toBeInTheDocument();
  });

  it('a case without a date of cremation reads "Not recorded" and offers Add', () => {
    renderSection([pickup()], { dateOfCremation: null });
    expect(fieldValue('Date of Cremation')).toHaveTextContent('Not recorded');
    expect(screen.getByRole('button', { name: 'Add date of cremation' })).toHaveTextContent('Add');
  });

  it('an archived case still shows every field, read-only for its case dates', () => {
    renderSection([pickup({ status: 'completed' })], { isDeleted: true, dateOfCremation: '10/10/2026', cremainsReceivedAt: null });
    expect(labels()).toHaveLength(5);
    expect(fieldValue('Date of Cremation')).toHaveTextContent('October 10, 2026');
    expect(fieldValue('Date Received')).toHaveTextContent('Received (date not recorded)');
    expect(screen.queryByRole('button', { name: /date of cremation|date received/i })).not.toBeInTheDocument();
  });
});
