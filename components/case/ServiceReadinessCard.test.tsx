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

describe('ServiceReadinessCard — release workflow (Phase 5K, holds 2026-11)', () => {
  const caps = (overrides: Record<string, unknown> = {}) => ({
    canRequestRelease: false,
    canSignOff: false,
    canHold: false,
    canReauthorize: false,
    canWithdraw: false,
    canCorrect: false,
    canConfirmCorrection: false,
    confirmCorrectionRefusal: null,
    canWithdrawCorrection: false,
    isCorrectionRequester: false,
    isOperator: true,
    isLicensedSigner: false,
    ...overrides,
  });
  const evaluation = (overrides: Record<string, unknown> = {}) => ({
    applies: true,
    released: false,
    status: 'not_released',
    hold: null,
    casePrerequisitesMet: true,
    prerequisites: [{ key: 'service_completed', label: 'Viewing marked completed', met: true }],
    allPrerequisitesMet: false,
    canRelease: false,
    unavailableReason: null,
    active: true,
    capabilities: caps({ canRequestRelease: true }),
    ...overrides,
  });
  const releasedRecord = (events: unknown[]): ServicePreparationRecord =>
    ({ definitionKey: 'prep.viewing', definitionVersion: 2, serviceAppointmentId: 'appt-fictional', choices: {}, details: {}, items: {}, releaseEvents: events }) as ServicePreparationRecord;
  const ev = (type: string, extra: Record<string, unknown> = {}) => ({ eventId: type, type, at: '2026-12-11T15:00:00.000Z', actorId: 'x', actorName: 'Jordan Demo', roleKey: 'funeralDirector', ...extra });

  it('an operational user without a license sees "Request release"; confirming posts only the action', async () => {
    const fetchMock = stubFetch({ preparation: view(), canEdit: true, release: evaluation() } as never, () => ({ status: 200, body: { status: 'awaiting_signoff' } }));
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    fireEvent.click(await screen.findByRole('button', { name: 'Request release' }));
    expect(screen.getByText(/sign-off is still required/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/cremation-release') && init?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes('/cremation-release'))!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, confirm: true, action: 'release' });
  });

  it('a licensed director with everything met sees "Release for cremation" and the sign-off wording', async () => {
    stubFetch({ preparation: view(), canEdit: true, release: evaluation({ allPrerequisitesMet: true, capabilities: caps({ canRequestRelease: true, isLicensedSigner: true }) }) } as never);
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    fireEvent.click(await screen.findByRole('button', { name: 'Release for cremation' }));
    expect(screen.getByText(/recorded with your name and license/)).toBeTruthy();
  });

  it('a hold needs a reason, and posts it', async () => {
    const fetchMock = stubFetch({ preparation: view({ record: releasedRecord([ev('released')]) }), canEdit: true, release: evaluation({ status: 'released', released: true, capabilities: caps({ canHold: true }) }) } as never, () => ({ status: 200, body: {} }));
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    fireEvent.click(await screen.findByRole('button', { name: 'Place on hold' }));
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason for the hold'), { target: { value: 'Family asked to wait' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/cremation-release'))).toBe(true));
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => String(url).includes('/cremation-release'))![1]!.body))).toMatchObject({ action: 'hold', reason: 'Family asked to wait' });
  });

  it('on hold after paperwork was sent: says to contact the crematory — a hold recalls nothing', async () => {
    const hold = { reason: 'Family asked to wait', at: '2026-12-12T15:00:00.000Z', byName: 'Morgan Demo', paperworkAlreadyTransmitted: true };
    stubFetch({ preparation: view({ record: releasedRecord([ev('released'), ev('hold_placed', { reason: hold.reason, paperworkAlreadyTransmitted: true })]) }), canEdit: true, release: evaluation({ status: 'on_hold', hold, capabilities: caps({ canReauthorize: true }) }) } as never);
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    expect((await screen.findByTestId('release-hold')).textContent).toMatch(/On hold: Family asked to wait/);
    expect(screen.getByTestId('release-hold-contact-crematory').textContent).toMatch(/does not recall anything/);
    expect(screen.getByRole('button', { name: 'Request reauthorization' })).toBeTruthy();
    expect(screen.getByTestId('release-history').textContent).toMatch(/Placed on hold[\s\S]*Released/);
  });

  it('while release is not active, controls are disabled and say why', async () => {
    stubFetch({ preparation: view(), canEdit: true, release: evaluation({ active: false, unavailableReason: 'Release for cremation is not active yet.' }) } as never);
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    expect((await screen.findByRole('button', { name: 'Request release' })).hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText(/not active yet/).length).toBeGreaterThan(0);
  });

  const postedRelease = (fetchMock: ReturnType<typeof stubFetch>) => JSON.parse(String(fetchMock.mock.calls.find(([url]) => String(url).includes('/cremation-release'))![1]!.body));

  it('a pending request can be withdrawn, with an optional reason', async () => {
    const fetchMock = stubFetch({ preparation: view({ record: releasedRecord([ev('release_requested')]) }), canEdit: true, release: evaluation({ status: 'awaiting_signoff', capabilities: caps({ canWithdraw: true }) }) } as never, () => ({ status: 200, body: {} }));
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw request' }));
    expect(screen.getByText(/stays in the history/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/cremation-release'))).toBe(true));
    expect(postedRelease(fetchMock)).toEqual({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, confirm: true, action: 'withdraw' });
  });

  it('correcting a sign-off needs a reason and names the sign-off; the history shows the correction', async () => {
    const fetchMock = stubFetch(
      { preparation: view({ record: releasedRecord([ev('released'), ev('release_corrected', { eventId: 'c0', correctsEventId: 'other', reason: 'Earlier note' })]) }), canEdit: true, release: evaluation({ status: 'released', released: true, capabilities: caps({ canCorrect: true, canHold: true }) }) } as never,
      () => ({ status: 200, body: {} }),
    );
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    expect((await screen.findByTestId('release-history')).textContent).toMatch(/Sign-off corrected/);
    fireEvent.click(screen.getByRole('button', { name: 'Correct a sign-off' }));
    expect(screen.getByText(/never changed/)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason for the correction'), { target: { value: 'Wrong appointment' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/cremation-release'))).toBe(true));
    expect(postedRelease(fetchMock)).toMatchObject({ action: 'correct', reason: 'Wrong appointment', correctsEventId: 'released' });
  });

  const pendingCorrectionRecord = () =>
    releasedRecord([ev('released', { actorId: 'b' }), ev('correction_requested', { eventId: 'cr1', actorId: 'c', actorName: 'Morgan Demo', correctsEventId: 'released', reason: 'Signed against the wrong appointment' })]);

  it('a correction awaiting confirmation: sending blocked, preparation read-only; the requester cannot confirm and sees why', async () => {
    stubFetch({
      preparation: view({ record: pendingCorrectionRecord() }),
      canEdit: true,
      release: evaluation({ status: 'correction_pending', capabilities: caps({ canWithdrawCorrection: true, isCorrectionRequester: true, confirmCorrectionRefusal: 'You asked for this correction, so someone else must confirm it.' }) }),
    } as never);
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    const notice = await screen.findByTestId('release-correction-pending');
    expect(notice.textContent).toMatch(/Nothing may be sent to the\s+crematory/);
    expect(notice.textContent).toMatch(/someone else must confirm it/);
    expect(screen.queryByRole('button', { name: 'Confirm correction' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Withdraw or decline correction' })).toBeTruthy();
    expect(screen.queryByTestId('release-hold')).toBeNull();
    expect(screen.getByText(/awaiting confirmation, so preparation is read-only/)).toBeTruthy();
    expect(screen.getAllByRole('combobox')[0].hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('release-history').textContent).toMatch(/Correction requested/);
    // The requester withdraws without a reason.
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw or decline correction' }));
    expect(screen.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(false);
  });

  it('an independent person confirms the correction (note optional); someone else declining must give a reason', async () => {
    const fetchMock = stubFetch(
      { preparation: view({ record: pendingCorrectionRecord() }), canEdit: true, release: evaluation({ status: 'correction_pending', capabilities: caps({ canConfirmCorrection: true, canWithdrawCorrection: true }) }) } as never,
      () => ({ status: 200, body: {} }),
    );
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw or decline correction' }));
    expect(screen.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Reason for declining')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm correction' }));
    expect(screen.getByText(/Confirming puts the release on hold/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/cremation-release'))).toBe(true));
    expect(postedRelease(fetchMock)).toEqual({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, confirm: true, action: 'confirm_correction' });
  });

  it('on hold, preparation is editable again but only with a reason, which is sent with the change', async () => {
    const hold = { reason: 'Family changed plans', at: '2026-12-12T15:00:00.000Z', byName: 'Morgan Demo', paperworkAlreadyTransmitted: false };
    const fetchMock = stubFetch({ preparation: view({ record: releasedRecord([ev('released'), ev('hold_placed', { reason: hold.reason })]) }), canEdit: true, release: evaluation({ status: 'on_hold', hold, capabilities: caps({ canReauthorize: true }) }) } as never);
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    const reasonBox = await screen.findByTestId('hold-change-reason');
    const select = screen.getAllByRole('combobox')[0];
    expect(select.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(reasonBox).getByRole('textbox'), { target: { value: 'Family now wants a spray' } });
    expect(select.hasAttribute('disabled')).toBe(false);
    const option = within(select).getAllByRole('option')[1] as HTMLOptionElement;
    fireEvent.change(select, { target: { value: option.value } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/service-preparation') && init?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/service-preparation') && init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ reason: 'Family now wants a spray' });
  });

  it('released, or with a reauthorization pending: preparation is read-only', async () => {
    stubFetch({ preparation: view({ record: releasedRecord([ev('released'), ev('hold_placed', { reason: 'x' }), ev('reauthorization_requested')]) }), canEdit: true, release: evaluation({ status: 'awaiting_reauthorization', capabilities: caps({ canWithdraw: true }) }) } as never);
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    expect(await screen.findByText(/Withdraw the request to make a change/)).toBeTruthy();
    expect(screen.queryByTestId('hold-change-reason')).toBeNull();
    expect(screen.getAllByRole('combobox')[0].hasAttribute('disabled')).toBe(true);
  });

  it('a read-only viewer sees the status but no enabled control', async () => {
    stubFetch({ preparation: view(), canEdit: false, release: evaluation() } as never);
    renderCard(caseWith(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), GUS_CAMACHO_ORGANIZATION_ID);
    expect((await screen.findByRole('button', { name: 'Request release' })).hasAttribute('disabled')).toBe(true);
  });
});
