import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseInformationCard } from './CaseInformationCard';
import { ChecklistCard } from './ChecklistCard';
import { CaseScheduleTab } from './CaseScheduleTab';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as appointmentsClient from '@/lib/appointmentsClient';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { casesService } from '@/services/casesService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { finalItemsCompletionPolicy } from '@/domain/workflow/completionPolicy';
import { burialStages, burialTemplate, burialVersion, caseOn, direct, directV } from '@/domain/workflow/crossServiceRegression.fixtures';
import { buildCaseViewModel } from '@/domain/cases/viewModel';
import { showsRemainsReturnControls } from '@/domain/cases/manualCompletionOffer';
import { EXPECTED_CREMAINS_PICKUP_TYPE } from '@/domain/scheduling/cremainsPickupPresentation';
import type { Appointment } from '@/types/appointment';
import type { Case } from '@/types/case';
import type { ChecklistItemViewModel } from '@/types/caseViewModel';

/**
 * Service-specific completion (2026-10). Burial / entombment policies
 * return no cremated remains, so Case Detail does not show return-method,
 * family pickup / release, shipping or cremains pickup controls for them.
 * Cremation and legacy (no policy — Manors) cases are unchanged. Display
 * only: stored values are never cleared. Fictional data only.
 */

vi.mock('@/services/casesService', () => ({
  casesService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
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

function burialCase(overrides: Partial<Case> = {}): Case {
  const version = { ...burialVersion(1, burialStages()), completionPolicy: finalItemsCompletionPolicy() };
  return { ...caseOn(burialTemplate([version]), version, 'bu-remains', 5), ...overrides };
}

const infoProps = {
  dateOfBirth: '03/14/1951',
  dateOfDeath: '07/09/2026',
  timeOfDeath: '14:30',
  placeOfDeath: 'FICTIONAL HOSPICE',
  weight: '178 lb',
  weightOver200: false,
  nextOfKinName: 'FICTIONAL RELATIVE',
  nextOfKinPhone: '555-0100',
  nextOfKinEmail: null,
  nextOfKinRelationship: null,
  nextOfKinRelationshipOther: null,
  certifierName: null,
  certifierPhone: null,
  certifierLicenseNumber: null,
  certifierFax: null,
  onSaveCertifierName: vi.fn(),
  onSaveCertifierPhone: vi.fn(),
  onSaveCertifierLicenseNumber: vi.fn(),
  onSaveCertifierFax: vi.fn(),
  tagNumber: null,
  paymentStatus: 'awaiting_payment' as const,
  pickupStatus: 'released' as const,
  pickupReleasedTo: 'FICTIONAL RELATIVE',
  pickupReleasedAt: '10/01/2026',
  pickupNote: null,
  shippingCarrier: 'FICTIONAL CARRIER',
  shippingTrackingNumber: null,
  shippingDateShipped: null,
  shippingDeliveryStatus: null,
  shippingDeliveredAt: null,
  ownerStaffId: 'staff-dana',
  staffOptions: [{ id: 'staff-dana', name: 'Dana' }],
  onReassignOwner: vi.fn(),
  onUpdateCaseInfo: vi.fn(),
  onSaveWeight: vi.fn(),
  onSaveTimeOfDeath: vi.fn(),
  isVeteran: false,
  veteranFlagLocked: false,
  onToggleVeteran: vi.fn(),
  vaSteps: [],
  vaCallbackDone: false,
  vaPublishChoice: null,
  vaNotificationResponsibility: null,
  onToggleVaStep: vi.fn(),
  onSetVaPublishChoice: vi.fn(),
  onSetVaNotificationResponsibility: vi.fn(),
};

describe('CaseInformationCard — remains return controls', () => {
  it.each([true, false])('cremation / legacy (default): Return method and the pickup release show (showOwner=%s)', (showOwner) => {
    render(<CaseInformationCard {...infoProps} showOwner={showOwner} returnMethod="pickup" pickupStatus="released" pickupReleasedTo="FICTIONAL FAMILY" />);
    expect(screen.getByText('Return method')).toBeInTheDocument();
    // The release record (Beacon shows it once the release is recorded).
    expect(screen.getByText(/Released to/)).toBeInTheDocument();
  });

  it.each([true, false])('burial: Return method, Cremated Remains and the release fields are hidden (showOwner=%s)', (showOwner) => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...infoProps} showOwner={showOwner} returnMethod="pickup" showRemainsReturn={false} onUpdateCaseInfo={onUpdateCaseInfo} />);
    expect(screen.queryByText('Return method')).not.toBeInTheDocument();
    expect(screen.queryByText('Cremated Remains')).not.toBeInTheDocument();
    expect(screen.queryByText('Released to')).not.toBeInTheDocument();
    expect(screen.queryByText('Family Picked Up')).not.toBeInTheDocument();
    // Display only — nothing is written to clear the stored values.
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    // The rest of the operational row is unaffected.
    expect(screen.getByText('Payment')).toBeInTheDocument();
  });

  it('burial: the shipping fields are hidden too', () => {
    render(<CaseInformationCard {...infoProps} showOwner returnMethod="shipping" showRemainsReturn={false} />);
    expect(screen.queryByText('Carrier')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipping status')).not.toBeInTheDocument();
  });

  it('cremation: the shipping fields still show', () => {
    render(<CaseInformationCard {...infoProps} showOwner returnMethod="shipping" showRemainsReturn />);
    expect(screen.getByText('Carrier')).toBeInTheDocument();
    expect(screen.getByText('Shipping status')).toBeInTheDocument();
  });
});

function renderChecklist(checklist: ChecklistItemViewModel[], showRemainsReturn?: boolean) {
  render(
    <ChecklistCard
      checklist={checklist}
      viewingStageLabel={null}
      onBackToCurrentStage={vi.fn()}
      onToggleItem={vi.fn()}
      onFieldChange={vi.fn()}
      onUpdateCaseInfo={vi.fn()}
      {...(showRemainsReturn !== undefined ? { showRemainsReturn } : {})}
    />,
  );
}

describe('ChecklistCard — return-of-remains action', () => {
  const terminalItem: ChecklistItemViewModel = {
    index: 0,
    label: 'Family picked up ashes',
    done: false,
    locked: false,
    hasField: false,
    fieldValue: '',
    fieldIsPassword: false,
    isDerived: true,
    returnRequirement: {
      returnMethod: 'pickup',
      pickupReleasedTo: null,
      pickupReleasedAt: null,
      pickupNote: null,
      shippingDeliveryStatus: null,
      shippingDeliveredAt: null,
    },
  };

  it('cremation (default): offers "Record family pickup"', () => {
    renderChecklist([terminalItem]);
    expect(screen.getByRole('button', { name: 'Record family pickup' })).toBeInTheDocument();
  });

  it('burial: never offers it', () => {
    renderChecklist([terminalItem], false);
    expect(screen.queryByRole('button', { name: 'Record family pickup' })).not.toBeInTheDocument();
  });

  it('a burial case on its final stage gets an ordinary final item from the view model — no pickup wording', () => {
    const viewModel = buildCaseViewModel(burialCase(), { staffList: [] } as unknown as Parameters<typeof buildCaseViewModel>[1]);
    expect(viewModel.checklist.some((item) => item.returnRequirement)).toBe(false);
    renderChecklist(viewModel.checklist, showsRemainsReturnControls(burialCase()));
    expect(screen.getByText('Fictional committal confirmed')).toBeInTheDocument();
    expect(screen.queryByText(/pickup|ashes/i)).not.toBeInTheDocument();
  });

  it('a cremation case on its final stage keeps the return-of-remains action', () => {
    const case_ = caseOn(direct, directV, 'dc-remains', 7, {});
    const viewModel = buildCaseViewModel({ ...case_, returnMethod: 'pickup' }, { staffList: [] } as unknown as Parameters<typeof buildCaseViewModel>[1]);
    renderChecklist(viewModel.checklist, showsRemainsReturnControls(case_));
    expect(screen.getByRole('button', { name: 'Record family pickup' })).toBeInTheDocument();
  });
});

function pickupAppointment(): Appointment {
  return {
    id: 'appt-pickup',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    appointmentType: EXPECTED_CREMAINS_PICKUP_TYPE,
    title: 'Fictional cremains pickup',
    notes: null,
    locationId: null,
    status: 'scheduled',
    startAt: '2026-10-20T14:00:00.000Z',
    endAt: '2026-10-20T15:00:00.000Z',
    timezone: 'America/Chicago',
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: null,
    createdBy: 'identity-1',
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: 'corr-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function renderSchedule() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <CaseScheduleTab caseId="case-1" />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('CaseScheduleTab — cremains pickup section', () => {
  beforeEach(() => {
    vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions: ['schedule.read', 'schedule.create', 'schedule.edit', 'schedule.cancel'] });
    vi.mocked(appointmentsClient.fetchCaseAppointments).mockResolvedValue([]);
  });
  afterEach(() => vi.clearAllMocks());

  it('cremation: the Cremains Pickup section shows', async () => {
    vi.mocked(casesService.get).mockResolvedValue(caseOn(direct, directV, 'case-1', 5));
    renderSchedule();
    expect(await screen.findByRole('region', { name: 'Cremains pickup' })).toBeInTheDocument();
  });

  it('burial: the Cremains Pickup section is not offered', async () => {
    vi.mocked(casesService.get).mockResolvedValue(burialCase());
    renderSchedule();
    expect(await screen.findByText('Schedule')).toBeInTheDocument();
    await screen.findByText('No upcoming appointments');
    expect(screen.queryByRole('region', { name: 'Cremains pickup' })).not.toBeInTheDocument();
  });

  it('burial: a pickup appointment already stored is still listed — hidden section, never hidden data', async () => {
    vi.mocked(casesService.get).mockResolvedValue(burialCase());
    vi.mocked(appointmentsClient.fetchCaseAppointments).mockResolvedValue([pickupAppointment()]);
    renderSchedule();
    expect(await screen.findByText('Fictional cremains pickup')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Cremains pickup' })).not.toBeInTheDocument();
  });
});
