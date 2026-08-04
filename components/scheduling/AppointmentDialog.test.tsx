import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppointmentDialog } from './AppointmentDialog';
import * as appointmentsClient from '@/lib/appointmentsClient';
import * as resourcesClient from '@/lib/resourcesClient';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { SchedulingConflictError } from '@/lib/appointmentsClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { Appointment } from '@/types/appointment';

vi.mock('@/lib/appointmentsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/appointmentsClient')>('@/lib/appointmentsClient');
  return { ...actual, createAppointment: vi.fn() };
});

vi.mock('@/lib/resourcesClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/resourcesClient')>('@/lib/resourcesClient');
  return { ...actual, fetchResources: vi.fn().mockResolvedValue([]) };
});

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn().mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions: ['resource.manage'] }) };
});

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: null,
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

function renderDialog(props: Partial<Parameters<typeof AppointmentDialog>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AppointmentDialog open onClose={onClose} organizationId={DEFAULT_ORGANIZATION_ID} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resourcesClient.fetchResources).mockResolvedValue([]);
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions: ['resource.manage'] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AppointmentDialog', () => {
  it('disables Save until a title is entered', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Arrangement Conference' } });
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });

  it('defaults the appointment type to Family Meeting', () => {
    renderDialog();
    expect(screen.getByLabelText('Appointment type')).toHaveValue('family.meeting');
  });

  it('shows a "Case ID" field when no caseId prop is supplied, and hides it when one is', () => {
    const { unmount } = renderDialog();
    expect(screen.getByLabelText('Case ID (optional)')).toBeInTheDocument();
    unmount();

    renderDialog({ caseId: 'case-1' });
    expect(screen.queryByLabelText('Case ID (optional)')).not.toBeInTheDocument();
  });

  it('creates the appointment with the chosen fields and closes on success', async () => {
    vi.mocked(appointmentsClient.createAppointment).mockResolvedValue(makeAppointment());
    const { onClose } = renderDialog({ caseId: 'case-1' });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Family Meeting' } });
    fireEvent.change(screen.getByLabelText('Appointment type'), { target: { value: 'viewing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(appointmentsClient.createAppointment).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', appointmentType: 'viewing', title: 'Family Meeting' }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows an inline error rather than closing when creation fails with a plain error', async () => {
    vi.mocked(appointmentsClient.createAppointment).mockRejectedValue(new Error('Unrecognized appointment type.'));
    const { onClose } = renderDialog();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Family Meeting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Unrecognized appointment type.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opens ConflictResolutionDialog instead of an inline error when creation hits a hard conflict', async () => {
    vi.mocked(appointmentsClient.createAppointment).mockRejectedValue(
      new SchedulingConflictError('Scheduling conflict: Main Chapel unavailable for this time.', [
        { resourceId: 'res-1', resourceName: 'Main Chapel', reason: 'overlapping_assignment', conflictingAppointmentId: 'appt-2', conflictingWindow: null },
      ]),
    );
    const { onClose } = renderDialog();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Family Meeting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('dialog', { name: 'Scheduling Conflict' })).toBeInTheDocument();
    expect(screen.getByText('Main Chapel', { exact: false })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('resets its fields each time it is reopened', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AppointmentDialog open onClose={onClose} organizationId={DEFAULT_ORGANIZATION_ID} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Draft title' } });

    rerender(
      <QueryClientProvider client={queryClient}>
        <AppointmentDialog open={false} onClose={onClose} organizationId={DEFAULT_ORGANIZATION_ID} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <AppointmentDialog open onClose={onClose} organizationId={DEFAULT_ORGANIZATION_ID} />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText('Title')).toHaveValue('');
  });
});
