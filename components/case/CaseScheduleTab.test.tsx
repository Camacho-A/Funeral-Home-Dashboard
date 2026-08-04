import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseScheduleTab } from './CaseScheduleTab';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as appointmentsClient from '@/lib/appointmentsClient';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { Appointment } from '@/types/appointment';

vi.mock('@/lib/appointmentsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/appointmentsClient')>('@/lib/appointmentsClient');
  return { ...actual, fetchCaseAppointments: vi.fn(), confirmAppointment: vi.fn(), cancelAppointment: vi.fn(), completeAppointment: vi.fn() };
});

vi.mock('@/lib/resourcesClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/resourcesClient')>('@/lib/resourcesClient');
  return { ...actual, fetchResources: vi.fn().mockResolvedValue([]) };
});

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    appointmentType: 'family.meeting',
    title: 'Family Meeting',
    notes: null,
    locationId: null,
    status: 'scheduled',
    startAt: '2026-09-01T14:00:00.000Z',
    endAt: '2026-09-01T15:00:00.000Z',
    timezone: 'America/Chicago',
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    createdBy: 'identity-1',
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: 'corr-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <CaseScheduleTab caseId="case-1" />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

beforeEach(() => {
  mockPermissions(['schedule.read', 'schedule.create', 'schedule.edit', 'schedule.cancel']);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CaseScheduleTab', () => {
  it('shows empty states for Upcoming and Completed when the case has no appointments', async () => {
    vi.mocked(appointmentsClient.fetchCaseAppointments).mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('No upcoming appointments for this case.')).toBeInTheDocument();
    expect(screen.getByText('No completed appointments yet.')).toBeInTheDocument();
    expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
  });

  it('lists a non-terminal appointment under Upcoming with its type, date, and time', async () => {
    vi.mocked(appointmentsClient.fetchCaseAppointments).mockResolvedValue([makeAppointment()]);
    renderTab();
    expect(await screen.findByText('Family Meeting')).toBeInTheDocument();
    expect(screen.getByText(/Sep 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('lists a completed appointment under Completed, not Upcoming', async () => {
    vi.mocked(appointmentsClient.fetchCaseAppointments).mockResolvedValue([makeAppointment({ status: 'completed' })]);
    renderTab();
    await screen.findByText('Family Meeting');
    expect(screen.getByText('No upcoming appointments for this case.')).toBeInTheDocument();
    expect(screen.queryByText('No completed appointments yet.')).not.toBeInTheDocument();
  });

  it('shows a Cancelled section only when a cancelled appointment exists', async () => {
    vi.mocked(appointmentsClient.fetchCaseAppointments).mockResolvedValue([makeAppointment({ id: 'appt-2', status: 'cancelled', title: 'Cancelled Meeting' })]);
    renderTab();
    expect(await screen.findByRole('heading', { name: 'Cancelled' })).toBeInTheDocument();
    expect(screen.getByText('Cancelled Meeting')).toBeInTheDocument();
  });

  it('confirms a draft appointment via the Confirm button', async () => {
    vi.mocked(appointmentsClient.fetchCaseAppointments).mockResolvedValue([makeAppointment({ status: 'draft' })]);
    vi.mocked(appointmentsClient.confirmAppointment).mockResolvedValue(makeAppointment({ status: 'confirmed' }));
    renderTab();
    await screen.findByText('Family Meeting');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(appointmentsClient.confirmAppointment).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, 'appt-1'));
  });

  it('cancels an appointment through the confirm dialog', async () => {
    vi.mocked(appointmentsClient.fetchCaseAppointments).mockResolvedValue([makeAppointment()]);
    vi.mocked(appointmentsClient.cancelAppointment).mockResolvedValue(makeAppointment({ status: 'cancelled' }));
    renderTab();
    await screen.findByText('Family Meeting');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Appointment' }));
    await waitFor(() => expect(appointmentsClient.cancelAppointment).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, 'appt-1', undefined));
  });

  it('hides the Cancel action when the caller lacks schedule.cancel', async () => {
    mockPermissions(['schedule.read', 'schedule.create', 'schedule.edit']);
    vi.mocked(appointmentsClient.fetchCaseAppointments).mockResolvedValue([makeAppointment()]);
    renderTab();
    await screen.findByText('Family Meeting');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('hides the Schedule Appointment button when the caller lacks schedule.create', async () => {
    mockPermissions(['schedule.read']);
    vi.mocked(appointmentsClient.fetchCaseAppointments).mockResolvedValue([]);
    renderTab();
    await screen.findByText('No upcoming appointments for this case.');
    expect(screen.queryByRole('button', { name: 'Schedule Appointment' })).not.toBeInTheDocument();
  });

  it('still renders the schedule when GET /api/rbac/my-permissions is unavailable (e.g. mock auth mode) rather than hiding every action', async () => {
    vi.mocked(identityAuthClient.fetchMyPermissions).mockRejectedValue(new Error('401'));
    vi.mocked(appointmentsClient.fetchCaseAppointments).mockResolvedValue([makeAppointment()]);
    renderTab();
    await screen.findByText('Family Meeting');
    expect(screen.getByRole('button', { name: 'Schedule Appointment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});
