import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServiceReadinessCard } from './ServiceReadinessCard';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { buildGusCaseFixtures } from '@/services/__mocks__/gusFixtures';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } from '@/domain/organization/organizationProfiles';
import { SERVICE_TYPE_CODES } from '@/domain/workflow/serviceWorkflows';
import type { Appointment } from '@/types/appointment';
import type { Case } from '@/types/case';

/** Service Readiness (Gus Phase 5B). Fictional cases and appointments; no network. */

const NOW = '2026-12-08T15:00:00.000Z';
const gusCases = buildGusCaseFixtures(new Date('2026-12-01T12:00:00.000Z'));
const caseWith = (code: string) => gusCases.find((c) => (c.workflowSnapshot?.serviceTypeCode ?? SERVICE_TYPE_CODES.DIRECT_CREMATION) === code)!;

function viewingAppointment(case_: Case, overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-fictional',
    organizationId: case_.organizationId,
    caseId: case_.id,
    appointmentType: 'viewing',
    title: 'Viewing',
    notes: null,
    locationId: null,
    status: 'scheduled',
    startAt: '2026-12-10T15:00:00.000Z',
    endAt: '2026-12-10T17:00:00.000Z',
    timezone: 'America/New_York',
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: null,
    createdBy: 'identity-fictional',
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: 'corr-fictional',
    createdAt: '2026-12-01T12:00:00.000Z',
    updatedAt: '2026-12-01T12:00:00.000Z',
    ...overrides,
  };
}

function renderCard(case_: Case, organizationId: string, appointments: Appointment[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(['caseAppointments', organizationId, case_.id], appointments);
  queryClient.setQueryData(['organization', organizationId], { id: organizationId, name: 'Fictional', isActive: true, timezone: 'America/New_York' });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={organizationId}>
        <ServiceReadinessCard case_={case_} now={NOW} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('ServiceReadinessCard', () => {
  it('shows a Viewing case its preparation, deadlines and the disabled release, before EDRS', () => {
    const viewing = caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING);
    expect(viewing.rawStage).toBeLessThan(3);
    renderCard(viewing, GUS_CAMACHO_ORGANIZATION_ID, [viewingAppointment(viewing)]);
    const card = screen.getByTestId('service-readiness');
    expect(within(card).getByText('Viewing preparation')).toBeTruthy();
    expect(within(card).getByText(/Draft — awaiting funeral director approval/)).toBeTruthy();
    // 48 hours before Dec 10 3:00 PM UTC has passed at NOW (Dec 8 3:00 PM UTC).
    expect(within(screen.getByTestId('prep-item-prep.crematory.notified')).getByText(/Overdue/)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Release for cremation' })).toHaveProperty('disabled', true);
    expect(within(card).getByText(/licensed funeral directors/)).toBeTruthy();
    expect(within(card).getByText(/awaiting approval/)).toBeTruthy();
    // Read-only: nothing to tick or type.
    expect(within(card).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(card).queryAllByRole('textbox')).toHaveLength(0);
  });

  it('asks for the service to be scheduled when there is none', () => {
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_FINAL_GOODBYE), GUS_CAMACHO_ORGANIZATION_ID);
    expect(screen.getByText(/No Final Goodbye scheduled yet/)).toBeTruthy();
  });

  it('renders nothing for Direct Cremation', () => {
    const { container } = renderCard(caseWith(SERVICE_TYPE_CODES.DIRECT_CREMATION), GUS_CAMACHO_ORGANIZATION_ID);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for an organization without service preparation (Manors)', () => {
    const viewing = { ...caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), organizationId: MANORS_ORGANIZATION_ID };
    const { container } = renderCard(viewing, MANORS_ORGANIZATION_ID, [viewingAppointment(viewing)]);
    expect(container.innerHTML).toBe('');
  });
});
