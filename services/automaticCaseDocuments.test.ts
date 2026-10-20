import { afterEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';
import { MANORS_ORGANIZATION_ID } from '../domain/organization/organizationProfiles';
import type { Case } from '../types/case';

const { generateBillingDocument, downloadOrgDocumentBytes, buildEnvelopePdf, buildCertificateOfCremationPdf } = vi.hoisted(() => ({
  generateBillingDocument: vi.fn(async (params: { buildPdf?: () => Promise<Uint8Array> }) => {
    await params.buildPdf?.();
    return { id: 'doc' };
  }),
  downloadOrgDocumentBytes: vi.fn(),
  buildEnvelopePdf: vi.fn(async () => new Uint8Array([1])),
  buildCertificateOfCremationPdf: vi.fn(async () => new Uint8Array([2])),
}));
vi.mock('./documentService', () => ({ generateBillingDocument, downloadOrgDocumentBytes }));
vi.mock('./officialDocumentTemplates', () => ({ buildEnvelopePdf, buildCertificateOfCremationPdf }));

const { generateOfficialDocument, regenerateOfficialDocumentsAfterCaseChange } = await import('./automaticCaseDocuments');

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

  it('does not produce an envelope for a case without a valid Tag Number', async () => {
    expect(await generateOfficialDocument('envelope', manorsCase({ tagNumber: null }), ctx, 'mock')).toBe('missing_information');
    expect(await generateOfficialDocument('envelope', manorsCase({ tagNumber: '  ' }), ctx, 'mock')).toBe('missing_information');
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
    expect(results).toEqual({ certificate_of_cremation: 'template_unavailable' });
    expect(buildEnvelopePdf).not.toHaveBeenCalled();
  });
});
