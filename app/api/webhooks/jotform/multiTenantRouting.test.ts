import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Multi-tenant JotForm routing (2026-10 hardening) — integration-style.
 *
 * Runs the REAL webhook handler, config service, submission service and
 * case-form-link service in `wix` mode against an in-memory stand-in for
 * lib/wixDataApi (the only persistence layer those services use), so
 * "nothing was written" is asserted against the data layer itself rather
 * than against a mocked service. Only side channels that would otherwise
 * reach the network or unrelated collections (activity log, notifications,
 * workflow reconciliation, document upload, Jotform itself) are stubbed.
 *
 * Two organizations share the backend: Manors (`managed-cremations`) with
 * its real Vital Statistics form id, and Gus Camacho Jr. (`gus-camacho-jr`)
 * with its own, distinct, synthetic form ids and no registered mapping.
 */

const { store, submissionApiRecords, writes } = vi.hoisted(() => ({
  store: new Map<string, Map<string, Record<string, unknown>>>(),
  submissionApiRecords: new Map<
    string,
    { formId: string; submittedAt: string | null; answers: Record<string, { answer: string | Record<string, string> }> }
  >(),
  writes: [] as Array<{ op: string; collection: string; id: string }>,
}));

vi.mock('@/lib/wixDataApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/wixDataApi')>('@/lib/wixDataApi');
  const collection = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };
  const matches = (id: string, data: Record<string, unknown>, filter: Record<string, unknown> | undefined) =>
    Object.entries(filter ?? {}).every(([key, expected]) => (key === '_id' ? id === expected : data[key] === expected));
  return {
    ...actual,
    queryWixDataItems: vi.fn(async (name: string, query: { filter?: Record<string, unknown>; paging?: { limit?: number } }) => {
      const items = [...collection(name).entries()]
        .filter(([id, data]) => matches(id, data, query.filter))
        .slice(0, query.paging?.limit ?? 50)
        .map(([id, data]) => ({ id, dataCollectionId: name, data: { ...data } }));
      return { dataItems: items };
    }),
    insertWixDataItem: vi.fn(async (name: string, data: Record<string, unknown>, id: string) => {
      if (collection(name).has(id)) throw new actual.WixDataApiError('conflict', 409);
      collection(name).set(id, { ...data });
      writes.push({ op: 'insert', collection: name, id });
      return { id, dataCollectionId: name, data: { ...data } };
    }),
    updateWixDataItem: vi.fn(async (name: string, id: string, data: Record<string, unknown>) => {
      collection(name).set(id, { ...data });
      writes.push({ op: 'update', collection: name, id });
      return { id, dataCollectionId: name, data: { ...data } };
    }),
    conditionalPatchWixDataItem: vi.fn(async () => {
      throw new Error('conditionalPatchWixDataItem is not expected in these scenarios');
    }),
  };
});

vi.mock('@/lib/jotform/jotformClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jotform/jotformClient')>('@/lib/jotform/jotformClient');
  return {
    ...actual,
    fetchSubmissionPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 synthetic')),
    fetchSubmissionAnswers: vi.fn(async (submissionId: string) => {
      const record = submissionApiRecords.get(submissionId);
      if (!record) throw new actual.JotformClientError('Jotform submission retrieval failed with status 401.', 'http_error');
      return record;
    }),
  };
});
vi.mock('@/services/documentService', () => ({ upload: vi.fn().mockResolvedValue({ id: 'document-multi-tenant' }) }));
vi.mock('@/services/activityService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/activityService')>();
  return {
    ...actual,
    recordExternalFormSubmissionReceived: vi.fn().mockResolvedValue(undefined),
    recordExternalFormSubmissionUnmatched: vi.fn().mockResolvedValue(undefined),
    recordExternalFormSubmissionLinked: vi.fn().mockResolvedValue(undefined),
    recordExternalFormSubmissionDuplicateSuspected: vi.fn().mockResolvedValue(undefined),
    recordExternalFormPdfStored: vi.fn().mockResolvedValue(undefined),
    recordExternalFormPdfFailed: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('@/services/intakeNotifications', () => ({ notifyIntakeSubmissionNeedsAttention: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/services/caseNotifications', () => ({
  notifyCaseCreated: vi.fn(),
  notifyArrangementReceived: vi.fn(),
  notifyVitalStatisticsReceived: vi.fn(),
  notifyJotformPdfImported: vi.fn(),
  notifyJotformPdfImportFailed: vi.fn(),
}));
vi.mock('@/services/workflowReconciliationService', () => ({ reconcileCaseWorkflow: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/services/casesService', () => ({
  get: vi.fn(async (_ctx: { organizationId: string }, caseId: string) => ({
    id: caseId,
    caseNumber: 'X0000-000',
    decedentName: 'Redacted',
    decedentMiddleName: null,
  })),
}));

const MANORS = 'managed-cremations';
const GUS = 'gus-camacho-jr';
const MANORS_VITAL_STATISTICS_FORM_ID = '262605621454050';
const MANORS_VS_CONFIG_ID = 'cfg-manors-vs';
/** Synthetic, clearly non-Manors ids standing in for Gus's own future forms. */
const GUS_FORM_ID = '300000000000001';
const GUS_INTAKE_FORM_ID = '300000000000002';
const GUS_FORM_CONFIG_ID = 'cfg-gus-form';
const GUS_LINK_QID = '9';

function configRow(overrides: Record<string, unknown>) {
  return {
    provider: 'jotform',
    label: 'Form',
    audience: 'staff',
    purpose: 'case_update',
    fieldMap: '{}',
    linkTokenFieldName: '',
    linkTokenFieldQid: '',
    webhookAuthFieldQid: '',
    isEnabled: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function seedConfigs(extra: Array<[string, Record<string, unknown>]> = []) {
  const configs = new Map<string, Record<string, unknown>>([
    [
      MANORS_VS_CONFIG_ID,
      configRow({
        organizationId: MANORS,
        externalFormId: MANORS_VITAL_STATISTICS_FORM_ID,
        label: 'Vital Statistics',
        audience: 'family',
        linkTokenFieldName: 'solislinktoken',
        linkTokenFieldQid: '44',
      }),
    ],
    [
      GUS_FORM_CONFIG_ID,
      configRow({ organizationId: GUS, externalFormId: GUS_FORM_ID, label: 'Gus Form', linkTokenFieldName: 'solisLinkToken', linkTokenFieldQid: GUS_LINK_QID }),
    ],
    [
      'cfg-gus-intake',
      configRow({ organizationId: GUS, externalFormId: GUS_INTAKE_FORM_ID, label: 'Gus Intake', purpose: 'case_create' }),
    ],
  ]);
  for (const [id, row] of extra) configs.set(id, row);
  store.set('externalFormConfigs', configs);
}

function jotformTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function givenJotformHasSubmission(formId: string, submissionId: string, answers: Record<string, string | Record<string, string>> = {}) {
  submissionApiRecords.set(submissionId, {
    formId,
    submittedAt: jotformTimestamp(),
    answers: Object.fromEntries(Object.entries(answers).map(([qid, answer]) => [qid, { answer }])),
  });
}

function webhookRequest(fields: Record<string, string>) {
  return new Request('http://localhost/api/webhooks/jotform', {
    method: 'POST',
    body: new URLSearchParams(fields).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

function storedSubmissions() {
  return [...(store.get('externalFormSubmissions')?.entries() ?? [])].map(([id, data]) => ({ id, ...data })) as Array<
    Record<string, unknown> & { id: string }
  >;
}

const fetchSpy = vi.fn(async () => {
  throw new Error('No network in this suite');
});

beforeEach(() => {
  store.clear();
  submissionApiRecords.clear();
  writes.length = 0;
  process.env.DATA_ADAPTER = 'wix';
  process.env.JOTFORM_API_KEY = 'default-test-key';
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  vi.stubGlobal('fetch', fetchSpy);
  seedConfigs();
});

afterEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  delete process.env.JOTFORM_API_KEY_GUS_CAMACHO_JR;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('two organizations with distinct form ids route independently', () => {
  it('a Manors form files under Manors with the Manors mapping; a Gus form files under Gus with generic handling', async () => {
    givenJotformHasSubmission(MANORS_VITAL_STATISTICS_FORM_ID, '2000000000000000001', {
      '3': { first: 'Ada', last: 'Lovelace' },
    });
    givenJotformHasSubmission(GUS_FORM_ID, '2000000000000000002', {
      // The same qid shape as Manors' Vital Statistics name field — it must
      // NOT be mapped for Gus, whose form has no registered layout.
      '3': { first: 'Grace', last: 'Hopper' },
    });

    const { POST } = await import('./route');
    const manors = await POST(webhookRequest({ formID: MANORS_VITAL_STATISTICS_FORM_ID, submissionID: '2000000000000000001' }));
    const gus = await POST(webhookRequest({ formID: GUS_FORM_ID, submissionID: '2000000000000000002' }));
    expect(manors.status).toBe(200);
    expect(gus.status).toBe(200);

    const subs = storedSubmissions();
    const manorsSub = subs.find((s) => s.externalSubmissionId === '2000000000000000001');
    const gusSub = subs.find((s) => s.externalSubmissionId === '2000000000000000002');
    expect(manorsSub?.organizationId).toBe(MANORS);
    expect(JSON.parse(manorsSub?.mappedFields as string)).toMatchObject({ decedentName: 'Ada Lovelace' });
    expect(gusSub?.organizationId).toBe(GUS);
    expect(JSON.parse(gusSub?.mappedFields as string)).toEqual({});
  });

  it('a Gus form uses its own Jotform account key when its config names one', async () => {
    process.env.JOTFORM_API_KEY_GUS_CAMACHO_JR = 'gus-key';
    const gusConfig = store.get('externalFormConfigs')!.get(GUS_FORM_CONFIG_ID)!;
    gusConfig.apiKeyReference = 'JOTFORM_API_KEY_GUS_CAMACHO_JR';
    givenJotformHasSubmission(GUS_FORM_ID, '2000000000000000003');

    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: GUS_FORM_ID, submissionID: '2000000000000000003' }));
    expect(response.status).toBe(200);
    expect(vi.mocked(fetchSubmissionAnswers)).toHaveBeenCalledWith('2000000000000000003', {
      apiKeyReference: 'JOTFORM_API_KEY_GUS_CAMACHO_JR',
    });
  });

  it('a Gus config naming a non-Jotform secret is refused before Jotform is called and nothing is written', async () => {
    const gusConfig = store.get('externalFormConfigs')!.get(GUS_FORM_CONFIG_ID)!;
    gusConfig.apiKeyReference = 'WIX_API_KEY';
    givenJotformHasSubmission(GUS_FORM_ID, '2000000000000000004');

    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: GUS_FORM_ID, submissionID: '2000000000000000004' }));
    expect(response.status).toBe(409);
    expect(fetchSubmissionAnswers).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('a Gus case_create form with no registered mapping never creates a case — the submission waits for staff', async () => {
    givenJotformHasSubmission(GUS_INTAKE_FORM_ID, '2000000000000000005', { '3': { first: 'A', last: 'B' } });
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: GUS_INTAKE_FORM_ID, submissionID: '2000000000000000005' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ caseCreated: false });
    const sub = storedSubmissions().find((s) => s.externalSubmissionId === '2000000000000000005');
    expect(sub?.organizationId).toBe(GUS);
    expect(sub?.status).toBe('unmatched');
    expect(String(sub?.caseCreationFailureReason)).toMatch(/^missing_required_fields/);
    // Never reached POST /api/cases.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('a form id configured in more than one organization is rejected', () => {
  it('fails closed (409): Jotform is never called and nothing is written to any organization', async () => {
    // The forbidden configuration: Gus reusing a Manors form id.
    seedConfigs([
      ['cfg-gus-reusing-manors', configRow({ organizationId: GUS, externalFormId: MANORS_VITAL_STATISTICS_FORM_ID, label: 'Copied' })],
    ]);
    givenJotformHasSubmission(MANORS_VITAL_STATISTICS_FORM_ID, '2000000000000000010', { '3': { first: 'Ada', last: 'Lovelace' } });

    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: MANORS_VITAL_STATISTICS_FORM_ID, submissionID: '2000000000000000010' }));

    expect(response.status).toBe(409);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain(GUS);
    expect(body).not.toContain(MANORS);
    expect(fetchSubmissionAnswers).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(storedSubmissions()).toEqual([]);
  });

  it('two enabled rows for one form inside ONE organization are just as ambiguous', async () => {
    seedConfigs([
      ['cfg-manors-vs-dup', configRow({ organizationId: MANORS, externalFormId: MANORS_VITAL_STATISTICS_FORM_ID, label: 'Dup' })],
    ]);
    givenJotformHasSubmission(MANORS_VITAL_STATISTICS_FORM_ID, '2000000000000000011');
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: MANORS_VITAL_STATISTICS_FORM_ID, submissionID: '2000000000000000011' }));
    expect(response.status).toBe(409);
    expect(writes).toEqual([]);
  });

  it('a disabled duplicate does not block the enabled owner', async () => {
    seedConfigs([
      [
        'cfg-gus-disabled-copy',
        configRow({ organizationId: GUS, externalFormId: MANORS_VITAL_STATISTICS_FORM_ID, label: 'Copied', isEnabled: false }),
      ],
    ]);
    givenJotformHasSubmission(MANORS_VITAL_STATISTICS_FORM_ID, '2000000000000000012');
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: MANORS_VITAL_STATISTICS_FORM_ID, submissionID: '2000000000000000012' }));
    expect(response.status).toBe(200);
    expect(storedSubmissions()[0]?.organizationId).toBe(MANORS);
  });
});

describe('deployment organization boundary', () => {
  it('DEPLOYMENT_ORGANIZATION_IDS=gus-camacho-jr: a Manors form submission is answered like an unknown form and nothing is written', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = GUS;
    givenJotformHasSubmission(MANORS_VITAL_STATISTICS_FORM_ID, '2000000000000000020', { '3': { first: 'Ada', last: 'Lovelace' } });

    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: MANORS_VITAL_STATISTICS_FORM_ID, submissionID: '2000000000000000020' }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Unrecognized or disabled form.' });
    expect(fetchSubmissionAnswers).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('the same deployment still processes its own Gus form', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = GUS;
    givenJotformHasSubmission(GUS_FORM_ID, '2000000000000000021');
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: GUS_FORM_ID, submissionID: '2000000000000000021' }));
    expect(response.status).toBe(200);
    expect(storedSubmissions().map((s) => s.organizationId)).toEqual([GUS]);
  });

  it('DEPLOYMENT_ORGANIZATION_IDS=managed-cremations (Manors): a Gus form submission is answered like an unknown form and nothing is written', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = MANORS;
    givenJotformHasSubmission(GUS_FORM_ID, '2000000000000000022');

    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: GUS_FORM_ID, submissionID: '2000000000000000022' }));

    expect(response.status).toBe(404);
    expect(fetchSubmissionAnswers).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('the Manors deployment still processes its own Manors form', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = MANORS;
    givenJotformHasSubmission(MANORS_VITAL_STATISTICS_FORM_ID, '2000000000000000023', { '3': { first: 'Ada', last: 'Lovelace' } });
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: MANORS_VITAL_STATISTICS_FORM_ID, submissionID: '2000000000000000023' }));
    expect(response.status).toBe(200);
    expect(storedSubmissions().map((s) => s.organizationId)).toEqual([MANORS]);
  });
});

describe('a submission can never update another organization\'s case', () => {
  it('a Manors link token submitted through a Gus form is unmatched; the Manors link is untouched', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { link, rawToken } = await generateLinkForSending(MANORS, 'case-manors-1', 'jotform', MANORS_VS_CONFIG_ID, 'wix');
    writes.length = 0;

    givenJotformHasSubmission(GUS_FORM_ID, '2000000000000000030', { [GUS_LINK_QID]: rawToken });
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: GUS_FORM_ID, submissionID: '2000000000000000030' }));
    expect(response.status).toBe(200);

    const sub = storedSubmissions().find((s) => s.externalSubmissionId === '2000000000000000030');
    expect(sub?.organizationId).toBe(GUS);
    expect(sub?.status).toBe('unmatched');
    expect(sub?.caseFormLinkId).toBeNull();
    expect(store.get('caseFormLinks')!.get(link.id)?.status).toBe('sent');
    // The only writes are the Gus submission row itself (+ its PDF state) —
    // never a caseFormLinks write.
    expect(writes.filter((w) => w.collection === 'caseFormLinks')).toEqual([]);
    const { reconcileCaseWorkflow } = await import('@/services/workflowReconciliationService');
    expect(reconcileCaseWorkflow).not.toHaveBeenCalled();
  });

  it('control: the same token through the Manors form it was issued for links the Manors case', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { link, rawToken } = await generateLinkForSending(MANORS, 'case-manors-2', 'jotform', MANORS_VS_CONFIG_ID, 'wix');
    givenJotformHasSubmission(MANORS_VITAL_STATISTICS_FORM_ID, '2000000000000000031', { '44': rawToken });

    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: MANORS_VITAL_STATISTICS_FORM_ID, submissionID: '2000000000000000031' }));
    expect(response.status).toBe(200);
    expect(store.get('caseFormLinks')!.get(link.id)?.status).toBe('received');
    const { notifyVitalStatisticsReceived } = await import('@/services/caseNotifications');
    expect(notifyVitalStatisticsReceived).toHaveBeenCalledTimes(1);
  });
});
