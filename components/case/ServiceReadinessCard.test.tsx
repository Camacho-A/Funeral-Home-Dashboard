import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServiceReadinessCard } from './ServiceReadinessCard';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { buildGusCaseFixtures } from '@/services/__mocks__/gusFixtures';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } from '@/domain/organization/organizationProfiles';
import { SERVICE_TYPE_CODES } from '@/domain/workflow/serviceWorkflows';
import type { ServicePreparationView } from '@/services/servicePreparationService';
import type { ServicePreparationRecord } from '@/domain/servicePreparation/types';
import type { Case } from '@/types/case';

/** Service Readiness (Gus Phase 5B/5C). Fictional cases; the route is stubbed (no network). */

const NOW = '2026-12-08T15:00:00.000Z';
const gusCases = buildGusCaseFixtures(new Date('2026-12-01T12:00:00.000Z'));
const caseWith = (code: string) => gusCases.find((c) => (c.workflowSnapshot?.serviceTypeCode ?? SERVICE_TYPE_CODES.DIRECT_CREMATION) === code)!;
const SERVICE = { appointmentId: 'appt-fictional', startAt: '2026-12-10T15:00:00.000Z', endAt: '2026-12-10T17:00:00.000Z', status: 'scheduled' as const, bookedAt: '2026-12-01T12:00:00.000Z' };

function view(overrides: Partial<ServicePreparationView> = {}): ServicePreparationView {
  return { applies: true, definitionKey: 'prep.viewing', record: null, service: SERVICE, documents: [], isArchived: false, storageAvailable: true, ...overrides };
}

function stubFetch(get: { preparation: ServicePreparationView; canEdit: boolean; medicalExaminer?: unknown }, postResponse?: (body: unknown) => { status: number; body: unknown }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const result = postResponse ? postResponse(JSON.parse(String(init.body))) : { status: 200, body: { preparation: get.preparation } };
      return new Response(JSON.stringify(result.body), { status: result.status });
    }
    return new Response(JSON.stringify(get), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderCard(case_: Case, organizationId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['organization', organizationId], { id: organizationId, name: 'Fictional', isActive: true, timezone: 'America/New_York' });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={organizationId}>
        <ServiceReadinessCard case_={case_} now={NOW} onOpenDocuments={() => undefined} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('ServiceReadinessCard', () => {
  it('shows a Viewing case its preparation and deadlines, before EDRS, with release still disabled', async () => {
    const viewing = caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING);
    expect(viewing.rawStage).toBeLessThan(3);
    stubFetch({ preparation: view(), canEdit: true });
    renderCard(viewing, GUS_CAMACHO_ORGANIZATION_ID);
    const card = await screen.findByTestId('service-readiness');
    expect(within(card).getByText('Viewing preparation')).toBeTruthy();
    // Viewing follows Gus's confirmed rules (Phase 5F): no longer a draft.
    expect(within(card).queryByText(/Draft — awaiting funeral director approval/)).toBeNull();
    expect(within(screen.getByTestId('prep-item-prep.crematory.notified')).getByText(/Overdue/)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Release for cremation' })).toHaveProperty('disabled', true);
    expect(within(card).getByText(/not active yet/)).toBeTruthy();
    expect(within(card).getByText(/Telling the crematory about the service is not a release/)).toBeTruthy();
  });

  it('saves a family choice and an item status, saying what each was based on', async () => {
    const fetchMock = stubFetch({ preparation: view(), canEdit: true });
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    await screen.findByTestId('service-readiness');
    fireEvent.change((document.getElementById('prep-choice-prayerCards') as HTMLSelectElement), { target: { value: 'requested' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const firstPost = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(firstPost[1]!.body))).toMatchObject({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, change: { kind: 'choice', choice: 'prayerCards', value: 'requested' }, basis: { at: null } });

    fireEvent.change(screen.getByLabelText('Status of Crematory told about the service'), { target: { value: 'completed' } });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
    const second = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')[1];
    expect(JSON.parse(String(second[1]!.body)).change).toEqual({ kind: 'item', itemId: 'prep.crematory.notified', status: 'completed' });
  });

  it('shows who did what, and asks to confirm again after the service moved', async () => {
    const record: ServicePreparationRecord = {
      definitionKey: 'prep.viewing',
      definitionVersion: 1,
      serviceAppointmentId: 'appt-fictional',
      choices: {},
      details: {},
      items: { 'prep.crematory.hold_confirmed': { status: 'confirmed', forServiceStartAt: '2026-12-09T15:00:00.000Z', note: null, documentId: null, at: '2026-12-02T12:00:00.000Z', by: 'identity-fictional', byName: 'Jordan Demo' } },
      release: null,
    };
    stubFetch({ preparation: view({ record }), canEdit: true });
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    const row = await screen.findByTestId('prep-item-prep.crematory.hold_confirmed');
    expect(within(row).getByText('Confirm again for the new date')).toBeTruthy();
    expect(within(row).getByText(/Jordan Demo/)).toBeTruthy();
    expect(within(row).getByText(/the service has moved/)).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Confirm for the new date' })).toBeTruthy();
  });

  it('shows the latest after a conflict, with the reason', async () => {
    stubFetch({ preparation: view(), canEdit: true }, () => ({ status: 409, body: { error: 'Someone else changed this while you were working on it.', preparation: view() } }));
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    await screen.findByTestId('service-readiness');
    fireEvent.change((document.getElementById('prep-choice-prayerCards') as HTMLSelectElement), { target: { value: 'requested' } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Someone else changed this/);
  });

  it('is read-only without permission to edit cases', async () => {
    stubFetch({ preparation: view(), canEdit: false });
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    await screen.findByTestId('service-readiness');
    expect(screen.queryByLabelText('Status of Crematory told about the service')).toBeNull();
    expect((document.getElementById('prep-choice-prayerCards') as HTMLSelectElement)).toHaveProperty('disabled', true);
    expect(screen.getByText(/needs permission to edit cases/)).toBeTruthy();
  });

  it('says saving is not available where the field has not been added', async () => {
    stubFetch({ preparation: view({ storageAvailable: false }), canEdit: true });
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    expect(await screen.findByText(/not available on this site yet/)).toBeTruthy();
    expect((document.getElementById('prep-choice-prayerCards') as HTMLSelectElement)).toHaveProperty('disabled', true);
  });

  it('asks for the service to be scheduled when there is none', async () => {
    stubFetch({ preparation: view({ definitionKey: 'prep.final_goodbye', service: null }), canEdit: true });
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_FINAL_GOODBYE), GUS_CAMACHO_ORGANIZATION_ID);
    expect(await screen.findByText(/No Final Goodbye scheduled yet/)).toBeTruthy();
  });

  it('renders nothing, and asks for nothing, for Direct Cremation or Manors', () => {
    const fetchMock = stubFetch({ preparation: view(), canEdit: true });
    const direct = renderCard(caseWith(SERVICE_TYPE_CODES.DIRECT_CREMATION), GUS_CAMACHO_ORGANIZATION_ID);
    expect(direct.container.innerHTML).toBe('');
    direct.unmount();
    const manors = renderCard({ ...caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), organizationId: MANORS_ORGANIZATION_ID }, MANORS_ORGANIZATION_ID);
    expect(manors.container.innerHTML).toBe('');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('service-preparation'))).toHaveLength(0);
  });
});

describe('ServiceReadinessCard — preparation history (Phase 5E)', () => {
  it('lists the saved history, newest first, with who and when', async () => {
    const record: ServicePreparationRecord = {
      definitionKey: 'prep.viewing',
      definitionVersion: 1,
      serviceAppointmentId: null,
      choices: {},
      details: {},
      items: {},
      release: null,
      history: [
        { eventId: 'e1', target: { kind: 'choice', key: 'prayerCards' }, description: 'Viewing preparation: Prayer cards — Requested', previous: null, next: { value: 'requested', at: '2026-12-02T12:00:00.000Z', by: 'i' }, actorId: 'i', actorName: 'Jordan Demo', at: '2026-12-02T12:00:00.000Z' },
        { eventId: 'e2', target: { kind: 'choice', key: 'prayerCards' }, description: 'Viewing preparation: Prayer cards — Not requested', previous: { value: 'requested', at: '2026-12-02T12:00:00.000Z', by: 'i' }, next: { value: 'not_requested', at: '2026-12-02T13:00:00.000Z', by: 'i' }, actorId: 'i', actorName: 'Avery Demo', at: '2026-12-02T13:00:00.000Z' },
      ],
    };
    stubFetch({ preparation: view({ record }), canEdit: true });
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    const history = await screen.findByTestId('prep-history');
    expect(within(history).getByText('Preparation history (2)')).toBeTruthy();
    const items = within(history).getAllByRole('listitem');
    expect(items[0].textContent).toMatch(/Not requested.*Avery Demo/);
    expect(items[1].textContent).toMatch(/Requested.*Jordan Demo/);
  });
});

describe('ServiceReadinessCard — medical examiner approval (Phase 5G)', () => {
  it('shows it is not recorded, and records it with the EDRS confirmation, date, reference and evidence', async () => {
    const fetchMock = stubFetch({ preparation: view(), canEdit: true, medicalExaminer: { approval: null, history: [] } }, () => ({ status: 200, body: { medicalExaminer: { approval: null, history: [] } } }));
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    const section = await screen.findByTestId('me-approval');
    expect(within(section).getByText(/Not recorded/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Record the approval' }));
    const save = within(section).getByRole('button', { name: 'Save approval' });
    expect(save).toHaveProperty('disabled', true); // needs the EDRS confirmation first
    fireEvent.click(within(section).getByRole('checkbox'));
    fireEvent.change(within(section).getByLabelText('Approval date'), { target: { value: '2026-12-07' } });
    fireEvent.change(within(section).getByLabelText('EDRS or medical examiner reference'), { target: { value: 'EDRS-FICTIONAL-1' } });
    fireEvent.change(within(section).getByLabelText('Where it was verified (if no document)'), { target: { value: 'EDRS screen' } });
    fireEvent.click(save);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('medical-examiner-approval'))).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('medical-examiner-approval'))!;
    expect(JSON.parse(String(call[1]!.body))).toMatchObject({ confirmedInEdrs: true, approvalDate: '2026-12-07', reference: 'EDRS-FICTIONAL-1', evidenceSource: 'EDRS screen', reason: null });
  });

  it('shows a recorded approval, and asks for a reason to correct it', async () => {
    const approval = { confirmedInEdrs: true, approvalDate: '2026-12-07', reference: 'EDRS-FICTIONAL-1', evidence: { documentId: null, source: 'EDRS screen' }, recordedBy: 'i', recordedByName: 'Jordan Demo', recordedAt: '2026-12-07T15:00:00.000Z', eventId: 'e' };
    stubFetch({ preparation: view(), canEdit: true, medicalExaminer: { approval, history: [] } });
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    const section = await screen.findByTestId('me-approval');
    expect(within(section).getByText(/approved 2026-12-07, ref. EDRS-FICTIONAL-1/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Correct the approval' }));
    expect(within(section).getByLabelText('Reason for the correction')).toBeTruthy();
  });

  it('read-only staff cannot record it', async () => {
    stubFetch({ preparation: view(), canEdit: false, medicalExaminer: { approval: null, history: [] } });
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    const section = await screen.findByTestId('me-approval');
    expect(within(section).queryByRole('button', { name: 'Record the approval' })).toBeNull();
  });
});

describe('ServiceReadinessCard — release for cremation (Phase 5K)', () => {
  const evaluation = (overrides: Record<string, unknown> = {}) => ({
    applies: true,
    released: false,
    prerequisites: [{ key: 'service_completed', label: 'Viewing marked completed', met: true }],
    allPrerequisitesMet: true,
    canRelease: true,
    unavailableReason: null,
    ...overrides,
  });

  it('when release is allowed, it asks the director to confirm, then posts only a confirmation', async () => {
    const fetchMock = stubFetch({ preparation: view(), canEdit: true, release: evaluation() } as never, () => ({ status: 200, body: { release: {} } }));
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    fireEvent.click(await screen.findByRole('button', { name: 'Release for cremation' }));
    expect(screen.getByText(/recorded with your name and license/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm release' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/cremation-release') && init?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes('/cremation-release'))!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, confirm: true });
  });

  it('shows the server’s refusal and releases nothing', async () => {
    stubFetch({ preparation: view(), canEdit: true, release: evaluation() } as never, () => ({ status: 423, body: { error: 'Release for cremation is not active yet. Nothing was released.' } }));
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    fireEvent.click(await screen.findByRole('button', { name: 'Release for cremation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm release' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Nothing was released/);
  });

  it('with requirements unmet, the button stays disabled and says why', async () => {
    stubFetch({ preparation: view(), canEdit: true, release: evaluation({ allPrerequisitesMet: false, canRelease: false }) } as never);
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    expect((await screen.findByRole('button', { name: 'Release for cremation' })).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Every requirement above must be met first.')).toBeTruthy();
  });

  it('a recorded release shows who released it, when, and on which license — and no button', async () => {
    const record: ServicePreparationRecord = {
      definitionKey: 'prep.viewing',
      definitionVersion: 2,
      serviceAppointmentId: 'appt-fictional',
      choices: {},
      details: {},
      items: {},
      release: {
        releasedAt: '2026-12-11T15:00:00.000Z',
        releasedBy: 'identity-gus-director',
        releasedByName: 'Jordan Demo',
        roleKey: 'funeralDirector',
        eventId: 'r1',
        approval: { staffProfileId: 's', basis: 'funeral_director_role', licenseNumber: 'FD-FICTIONAL-0001', licenseState: 'FL', licenseExpiresOn: '2030-01-31', licenseVerifiedAt: null, licenseVerifiedBy: null, serviceAppointmentId: 'appt-fictional', prerequisites: [] },
      },
    };
    stubFetch({ preparation: view({ record }), canEdit: true, release: evaluation({ released: true, canRelease: false }) } as never);
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    const recorded = await screen.findByTestId('release-recorded');
    expect(recorded.textContent).toMatch(/Released for cremation by Jordan Demo/);
    expect(recorded.textContent).toMatch(/FL license FD-FICTIONAL-0001/);
    expect(screen.queryByRole('button', { name: 'Release for cremation' })).toBeNull();
  });
});
