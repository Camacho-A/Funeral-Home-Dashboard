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

  it('does nothing for a case of another organization, or without a date of cremation', async () => {
    expect(await generateOfficialDocument('envelope', manorsCase({ organizationId: 'other' }), ctx, 'mock')).toBe('not_applicable');
    process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_PATH = '/nonexistent';
    expect(await generateOfficialDocument('certificate_of_cremation', manorsCase({ dateOfCremation: null }), ctx, 'mock')).toBe('not_applicable');
    expect(generateBillingDocument).not.toHaveBeenCalled();
  });

  it('reports a failure instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    generateBillingDocument.mockRejectedValueOnce(new Error('storage down'));
    expect(await generateOfficialDocument('envelope', manorsCase(), ctx, 'mock')).toBe('failed');
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
