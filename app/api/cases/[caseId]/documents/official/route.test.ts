import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { generateOfficialDocumentForCase, canGenerateDocument } = vi.hoisted(() => ({
  generateOfficialDocumentForCase: vi.fn(),
  canGenerateDocument: vi.fn(async () => true),
}));
vi.mock('@/services/automaticCaseDocuments', () => ({ generateOfficialDocumentForCase }));
vi.mock('@/services/authorizationPolicyService', async () => {
  const actual = await vi.importActual<typeof import('@/services/authorizationPolicyService')>('@/services/authorizationPolicyService');
  return { ...actual, canGenerateDocument };
});

const { POST } = await import('./route');

function post(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/cases/case-1/documents/official', { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId: 'case-1' }),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  mockSession = { user: mockDefaultUser };
});

describe('POST /api/cases/[caseId]/documents/official', () => {
  it('generates the requested document for the caller\'s organization', async () => {
    generateOfficialDocumentForCase.mockResolvedValue({ outcome: 'generated', missing: [] });
    const response = await post({ organizationId: DEFAULT_ORGANIZATION_ID, kind: 'envelope' });
    expect(response.status).toBe(201);
    expect(generateOfficialDocumentForCase).toHaveBeenCalledWith('envelope', 'case-1', expect.objectContaining({ organizationId: DEFAULT_ORGANIZATION_ID }), expect.anything());
  });

  it('says plainly when the signed certificate template is not set up', async () => {
    generateOfficialDocumentForCase.mockResolvedValue({ outcome: 'template_unavailable', missing: [] });
    const response = await post({ organizationId: DEFAULT_ORGANIZATION_ID, kind: 'certificate_of_cremation' });
    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error).toMatch(/template could not be found/);
    expect(error).toMatch(/case information is saved/);
    // Never leaks storage detail to the browser.
    expect(error).not.toMatch(/blob|managed-cremations|token/i);
  });

  it('explains what is missing on the case', async () => {
    generateOfficialDocumentForCase.mockResolvedValue({ outcome: 'missing_information', missing: ['Tag Number', 'Date of Cremation'] });
    const response = await post({ organizationId: DEFAULT_ORGANIZATION_ID, kind: 'certificate_of_cremation' });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe(
      'Before generating the Certificate of Cremation, add the following to this case: Tag Number, Date of Cremation.',
    );
  });

  it('a genuine failure says nothing on the case was changed', async () => {
    generateOfficialDocumentForCase.mockResolvedValue({ outcome: 'failed', missing: [] });
    const response = await post({ organizationId: DEFAULT_ORGANIZATION_ID, kind: 'certificate_of_cremation' });
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/Certificate of Cremation could not be generated. Nothing on the case was changed/);
  });

  it('404s a case outside the organization', async () => {
    generateOfficialDocumentForCase.mockResolvedValue({ outcome: 'case_not_found', missing: [] });
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, kind: 'envelope' })).status).toBe(404);
  });

  it('refuses an unknown kind, a caller without permission, and a cross-site request', async () => {
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, kind: 'invoice' })).status).toBe(400);
    canGenerateDocument.mockResolvedValueOnce(false);
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, kind: 'envelope' })).status).toBe(403);
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, kind: 'envelope' }, { origin: 'https://evil.example', host: 'localhost' })).status).toBe(403);
    expect(generateOfficialDocumentForCase).not.toHaveBeenCalled();
  });

  it('requires a session', async () => {
    mockSession = null;
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, kind: 'envelope' })).status).toBe(401);
  });
});
