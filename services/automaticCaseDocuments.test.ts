import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';
import { MANORS_ORGANIZATION_ID } from '../domain/organization/organizationProfiles';
import type { Case } from '../types/case';

const { generateBillingDocument, downloadOrgDocumentBytes, buildEnvelopePdf, buildCertificateOfCremationPdf, listDocuments } = vi.hoisted(() => ({
  listDocuments: vi.fn(async (): Promise<Array<{ documentTypeKey: string; status: string }>> => []),
  generateBillingDocument: vi.fn(async (params: { buildPdf?: () => Promise<Uint8Array> }) => {
    await params.buildPdf?.();
    return { id: 'doc' };
  }),
  downloadOrgDocumentBytes: vi.fn(),
  buildEnvelopePdf: vi.fn(async () => new Uint8Array([1])),
  buildCertificateOfCremationPdf: vi.fn(async () => new Uint8Array([2])),
}));
vi.mock('./documentService', () => ({ generateBillingDocument, downloadOrgDocumentBytes, list: listDocuments }));
vi.mock('./officialDocumentTemplates', () => ({ buildEnvelopePdf, buildCertificateOfCremationPdf }));

const { generateOfficialDocument, regenerateOfficialDocumentsAfterCaseChange, createEnvelopeAfterSentToCrematory } = await import('./automaticCaseDocuments');
const { crematorySentChecklistKeys } = await import('../domain/crematory/sentChecklistItems');

const ctx = { organizationId: MANORS_ORGANIZATION_ID, actorIdentityId: 'u', actorMembershipId: null, actorRoleKey: null, correlationId: 'c' };
const manorsCase = (overrides: Partial<Case> = {}): Case =>
  ({
    ...caseFixtures[0],
    id: 'case-1',
    organizationId: MANORS_ORGANIZATION_ID,
    decedentName: 'LOUIS BARBER',
    decedentMiddleName: 'ANTHONY',
    tagNumber: 'MC-1',
    dateOfDeath: '10/09/2026',
    dateOfCremation: '10/14/2026',
    isDeleted: false,
    ...overrides,
  }) as Case;

/** Both of Workflow 3's "sent to crematory" items checked. */
const sentToCrematory = (c: Case): Case => ({
  ...c,
  checklistState: { ...c.checklistState, ...Object.fromEntries(crematorySentChecklistKeys(c).map((key) => [key, true])) },
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY;
  delete process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_PATH;
});

describe('generateOfficialDocument', () => {
  it('files the envelope as a generated "Envelope", named in display case', async () => {
    expect(await generateOfficialDocument('envelope', manorsCase(), ctx, 'mock')).toBe('generated');
    expect(generateBillingDocument.mock.calls[0][0]).toMatchObject({ caseId: 'case-1', documentTypeKey: 'letter.envelope', fileName: 'Envelope.pdf' });
    expect(buildEnvelopePdf).toHaveBeenCalledWith({ decedentDisplayName: 'Louis Anthony Barber' });
  });

  it('reads the signed certificate from private storage and fills it with the case', async () => {
    process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY = 'managed-cremations/templates/certificate.pdf';
    downloadOrgDocumentBytes.mockResolvedValue({ buffer: Buffer.from([9]), contentType: 'application/pdf' });

    expect(await generateOfficialDocument('certificate_of_cremation', manorsCase(), ctx, 'mock')).toBe('generated');
    expect(downloadOrgDocumentBytes).toHaveBeenCalledWith('managed-cremations/templates/certificate.pdf');
    expect(buildCertificateOfCremationPdf).toHaveBeenCalledWith(expect.any(Uint8Array), {
      tagNumber: 'MC-1',
      decedentDisplayName: 'Louis Anthony Barber',
      dateOfDeath: 'October 9, 2026',
      dateOfCremation: 'October 14, 2026',
    });
    expect(generateBillingDocument.mock.calls[0][0]).toMatchObject({ documentTypeKey: 'cremation_form.certificate_of_cremation', fileName: 'Certificate of Cremation.pdf' });
  });

  it('never approximates the certificate when the signed template is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await generateOfficialDocument('certificate_of_cremation', manorsCase(), ctx, 'mock')).toBe('template_unavailable');
    expect(generateBillingDocument).not.toHaveBeenCalled();
  });

  it('produces an envelope without a Tag Number — the Envelope does not print one (2026-10)', async () => {
    expect(await generateOfficialDocument('envelope', manorsCase({ tagNumber: null }), ctx, 'mock')).toBe('generated');
    expect(await generateOfficialDocument('envelope', manorsCase({ tagNumber: '  ' }), ctx, 'mock')).toBe('generated');
    expect(buildEnvelopePdf).toHaveBeenCalledWith({ decedentDisplayName: 'Louis Anthony Barber' });
  });

  it('still refuses an envelope without the decedent\'s name', async () => {
    expect(await generateOfficialDocument('envelope', manorsCase({ decedentName: ' ' }), ctx, 'mock')).toBe('missing_information');
    expect(generateBillingDocument).not.toHaveBeenCalled();
  });

  it('does nothing for a case of another organization, or without a date of cremation', async () => {
    expect(await generateOfficialDocument('envelope', manorsCase({ organizationId: 'other' }), ctx, 'mock')).toBe('not_applicable');
    process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_PATH = '/nonexistent';
    expect(await generateOfficialDocument('certificate_of_cremation', manorsCase({ dateOfCremation: null }), ctx, 'mock')).toBe('missing_information');
    expect(generateBillingDocument).not.toHaveBeenCalled();
  });

  it('reports a failure instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    generateBillingDocument.mockRejectedValueOnce(new Error('storage down'));
    expect(await generateOfficialDocument('envelope', manorsCase(), ctx, 'mock')).toBe('failed');
  });
});

/**
 * Production failure, 2026-10-20 (B2026-036): the signed template had been
 * uploaded to the top of the store under its original file name, not at
 * the key in CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY. Storage said
 * "no blob found" and staff saw only "could not be generated".
 */
describe('Certificate of Cremation — required information and the template', () => {
  const KEY = 'managed-cremations/templates/certificate-of-cremation.pdf';

  it('needs a Tag Number, date of death and date of cremation, and checks before touching storage', async () => {
    process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY = KEY;
    for (const overrides of [{ tagNumber: null }, { tagNumber: '—' }, { dateOfDeath: '' }, { dateOfCremation: null }, { decedentName: ' ' }]) {
      expect(await generateOfficialDocument('certificate_of_cremation', manorsCase(overrides), ctx, 'mock'), JSON.stringify(overrides)).toBe(
        'missing_information',
      );
    }
    expect(downloadOrgDocumentBytes).not.toHaveBeenCalled();
    expect(generateBillingDocument).not.toHaveBeenCalled();
  });

  it('names exactly what is missing for staff', async () => {
    const { generateOfficialDocumentForCase } = await import('./automaticCaseDocuments');
    const loader = await import('./serverCaseLoader');
    vi.spyOn(loader, 'loadCaseOnServer').mockResolvedValue(manorsCase({ tagNumber: null, dateOfDeath: '' }));
    expect(await generateOfficialDocumentForCase('certificate_of_cremation', 'case-1', ctx, 'mock')).toEqual({
      outcome: 'missing_information',
      missing: ['Tag Number', 'Date of Death'],
    });
  });

  it('reports the template as unavailable — not a generic failure — when nothing is stored at the configured key', async () => {
    const { DocumentNotFoundError } = await import('../lib/documentStorageProvider');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY = KEY;
    downloadOrgDocumentBytes.mockRejectedValueOnce(new DocumentNotFoundError(KEY));

    expect(await generateOfficialDocument('certificate_of_cremation', manorsCase(), ctx, 'mock')).toBe('template_unavailable');
    expect(generateBillingDocument).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0][0])).toContain(`"${KEY}"`);
  });

  it('treats a storage outage (credentials, network) as a failure, not a missing template', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY = KEY;
    downloadOrgDocumentBytes.mockRejectedValueOnce(new Error('403 Forbidden'));
    expect(await generateOfficialDocument('certificate_of_cremation', manorsCase(), ctx, 'mock')).toBe('failed');
    expect(generateBillingDocument).not.toHaveBeenCalled();
  });

  it('fills the template with the case once everything is present', async () => {
    process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY = KEY;
    downloadOrgDocumentBytes.mockResolvedValue({ buffer: Buffer.from([9]), contentType: 'application/pdf' });
    expect(await generateOfficialDocument('certificate_of_cremation', manorsCase(), ctx, 'mock')).toBe('generated');
    expect(generateBillingDocument).toHaveBeenCalledTimes(1);
  });
});

describe('regenerateOfficialDocumentsAfterCaseChange', () => {
  it('generates only what the change affects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = manorsCase({ dateOfCremation: null });
    const results = await regenerateOfficialDocumentsAfterCaseChange(before, manorsCase(), ctx, 'mock');
    // The Cremation Label (2026-10) does not depend on the certificate template.
    expect(results).toEqual({ certificate_of_cremation: 'template_unavailable', cremation_label: 'generated' });
    expect(buildEnvelopePdf).not.toHaveBeenCalled();
  });

  /** 2026-11-10: the label ran after a Certificate whose save never
      finished, so adding the Tag # produced no label. */
  it('saves the Cremation Label before the Certificate, so a stuck or failed Certificate cannot stop it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY = 'k';
    downloadOrgDocumentBytes.mockResolvedValue({ buffer: Buffer.from([9]), contentType: 'application/pdf' });
    const original = generateBillingDocument.getMockImplementation()!;
    generateBillingDocument.mockImplementation(async (p: { documentTypeKey?: string; buildPdf?: () => Promise<Uint8Array> }) => {
      if (p.documentTypeKey === 'cremation_form.certificate_of_cremation') throw new Error('The document was not finished within 90 seconds.');
      await p.buildPdf?.();
      return { id: 'doc' };
    });
    const results = await regenerateOfficialDocumentsAfterCaseChange(manorsCase({ tagNumber: null }), manorsCase(), ctx, 'mock').finally(() =>
      generateBillingDocument.mockImplementation(original),
    );
    const order = generateBillingDocument.mock.calls.map((call) => (call[0] as { documentTypeKey: string }).documentTypeKey);
    expect(order[0]).toBe('cremation_form.cremation_label');
    expect(order).toContain('cremation_form.certificate_of_cremation');
    expect(results.cremation_label).toBe('generated');
    expect(results.certificate_of_cremation).toBe('failed');
  });
});

/**
 * Envelope without a Tag Number (2026-10). The Envelope carries only the
 * name, so a Tag Number neither gates it nor, when added or corrected later,
 * produces a second identical copy. The Certificate is unchanged.
 */
describe('regenerateOfficialDocumentsAfterCaseChange — Envelope and Certificate are independent', () => {
  const envelopeOnFile = [{ documentTypeKey: 'letter.envelope', status: 'active' }];
  afterEach(() => listDocuments.mockReset().mockResolvedValue([]));

  it('a case sent to the crematory with no Envelope gets one — no Tag Number needed; one that has an Envelope gets no duplicate (2026-11)', async () => {
    const before = manorsCase({ tagNumber: null, dateOfCremation: null });
    expect(crematorySentChecklistKeys(before)).toHaveLength(2);
    expect(await regenerateOfficialDocumentsAfterCaseChange(before, sentToCrematory(before), ctx, 'mock')).toEqual({ envelope: 'generated' });
    expect(buildEnvelopePdf).toHaveBeenCalledWith({ decedentDisplayName: 'Louis Anthony Barber' });
    listDocuments.mockResolvedValue(envelopeOnFile);
    vi.clearAllMocks();
    expect(await regenerateOfficialDocumentsAfterCaseChange(before, sentToCrematory(before), ctx, 'mock')).toEqual({});
    expect(buildEnvelopePdf).not.toHaveBeenCalled();
  });

  it('saving a Tag Number no longer creates the Envelope', async () => {
    const before = manorsCase({ tagNumber: null, dateOfCremation: null });
    expect(await regenerateOfficialDocumentsAfterCaseChange(before, { ...before, tagNumber: 'MC-9' }, ctx, 'mock')).toEqual({});
    expect(buildEnvelopePdf).not.toHaveBeenCalled();
  });

  it('a name change regenerates an existing Envelope even without a Tag Number', async () => {
    listDocuments.mockResolvedValue(envelopeOnFile);
    const before = manorsCase({ tagNumber: null, dateOfCremation: null });
    expect(await regenerateOfficialDocumentsAfterCaseChange(before, { ...before, decedentMiddleName: 'ANTONIO' }, ctx, 'mock')).toEqual({ envelope: 'generated' });
    expect(buildEnvelopePdf).toHaveBeenCalledWith({ decedentDisplayName: 'Louis Antonio Barber' });
  });

  it('a name change on a case not yet sent and without an Envelope creates nothing; a new case gets none; once sent, a name change creates the first one', async () => {
    const before = manorsCase({ tagNumber: null, dateOfCremation: null });
    expect(await regenerateOfficialDocumentsAfterCaseChange(before, { ...before, decedentMiddleName: 'ANTONIO' }, ctx, 'mock')).toEqual({});
    expect(await regenerateOfficialDocumentsAfterCaseChange(null, before, ctx, 'mock')).toEqual({});
    expect(generateBillingDocument).not.toHaveBeenCalled();
    const sent = sentToCrematory(before);
    expect(await regenerateOfficialDocumentsAfterCaseChange(sent, { ...sent, decedentMiddleName: 'ANTONIO' }, ctx, 'mock')).toEqual({ envelope: 'generated' });
  });

  it('the Certificate still requires the Tag Number and is not blocked by, or blocking, the Envelope', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY = 'k';
    downloadOrgDocumentBytes.mockResolvedValue({ buffer: Buffer.from([9]), contentType: 'application/pdf' });
    expect(await generateOfficialDocument('certificate_of_cremation', manorsCase({ tagNumber: null }), ctx, 'mock')).toBe('missing_information');
    const noCert = manorsCase({ dateOfCremation: null, tagNumber: null });
    const result = await regenerateOfficialDocumentsAfterCaseChange(noCert, sentToCrematory(noCert), ctx, 'mock');
    expect(result).toEqual({ envelope: 'generated' });
    const both = await regenerateOfficialDocumentsAfterCaseChange(manorsCase({ dateOfCremation: null }), manorsCase(), ctx, 'mock');
    expect(both).toEqual({ certificate_of_cremation: 'generated', cremation_label: 'generated' });
  });

  it('if existing documents cannot be read, no Envelope is generated automatically (no risk of a duplicate)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    listDocuments.mockRejectedValue(new Error('storage down'));
    const before = manorsCase({ tagNumber: null, dateOfCremation: null });
    expect(await regenerateOfficialDocumentsAfterCaseChange(before, sentToCrematory(before), ctx, 'mock')).toEqual({});
  });
});

/** After SOLIS's own Send to Crematory (2026-11): the send completes the two
    items outside a case save, so the Envelope is created from the stored case. */
describe('createEnvelopeAfterSentToCrematory', () => {
  let loadCaseOnServer: MockInstance<typeof import('./serverCaseLoader').loadCaseOnServer>;
  beforeEach(async () => {
    const loader = await import('./serverCaseLoader');
    loadCaseOnServer = vi.spyOn(loader, 'loadCaseOnServer');
  });
  afterEach(() => {
    listDocuments.mockReset().mockResolvedValue([]);
    loadCaseOnServer.mockRestore();
  });

  it('creates the Envelope for a sent case that has none — no Tag Number needed', async () => {
    loadCaseOnServer.mockResolvedValue(sentToCrematory(manorsCase({ tagNumber: null, dateOfCremation: null })));
    expect(await createEnvelopeAfterSentToCrematory(ctx, 'case-1', 'mock')).toBe('generated');
    expect(buildEnvelopePdf).toHaveBeenCalledWith({ decedentDisplayName: 'Louis Anthony Barber' });
  });

  it('never a second Envelope, nothing for a case not sent, archived, nameless, or another organization', async () => {
    loadCaseOnServer.mockResolvedValue(sentToCrematory(manorsCase()));
    listDocuments.mockResolvedValue([{ documentTypeKey: 'letter.envelope', status: 'active' }]);
    expect(await createEnvelopeAfterSentToCrematory(ctx, 'case-1', 'mock')).toBe('not_due');
    listDocuments.mockResolvedValue([]);
    loadCaseOnServer.mockResolvedValue(manorsCase());
    expect(await createEnvelopeAfterSentToCrematory(ctx, 'case-1', 'mock')).toBe('not_due');
    loadCaseOnServer.mockResolvedValue(sentToCrematory(manorsCase({ isDeleted: true })));
    expect(await createEnvelopeAfterSentToCrematory(ctx, 'case-1', 'mock')).toBe('not_due');
    loadCaseOnServer.mockResolvedValue(sentToCrematory(manorsCase({ decedentName: '' })));
    expect(await createEnvelopeAfterSentToCrematory(ctx, 'case-1', 'mock')).toBe('not_due');
    loadCaseOnServer.mockResolvedValue(sentToCrematory(manorsCase({ organizationId: 'some-other-home' })));
    expect(await createEnvelopeAfterSentToCrematory(ctx, 'case-1', 'mock')).toBe('not_applicable');
    expect(buildEnvelopePdf).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    loadCaseOnServer.mockRejectedValue(new Error('Wix down'));
    expect(await createEnvelopeAfterSentToCrematory(ctx, 'case-1', 'mock')).toBe('failed');
  });
});
