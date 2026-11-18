import { afterEach, describe, expect, it, vi } from 'vitest';
import { GUS_CAMACHO_ORGANIZATION_ID } from '@/domain/organization/organizationProfiles';

/** ME cremation approval API (Gus Phase 5G): case.update only. Fictional data. */
let session = { organizationId: GUS_CAMACHO_ORGANIZATION_ID, userId: 'identity-gus-director', role: 'funeralDirector' };
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (requested: string) =>
    requested !== session.organizationId
      ? { authorized: false, response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) }
      : { authorized: true, context: { organizationId: requested, userId: session.userId, role: session.role } },
  ),
}));

const { POST } = await import('./route');
const { caseFixtures } = await import('@/services/__mocks__/fixtures');
const index = caseFixtures.findIndex((c) => c.id === 'gus-case-010' && c.organizationId === GUS_CAMACHO_ORGANIZATION_ID);
const original = caseFixtures[index];
const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const body = { confirmedInEdrs: true, approvalDate: new Date().toISOString().slice(0, 10), reference: 'EDRS-FICTIONAL-1', evidenceSource: 'EDRS screen (fictional)' };
const post = (extra: Record<string, unknown> = {}, headers = SAME_ORIGIN) =>
  POST(new Request('http://localhost/api/cases/gus-case-010/medical-examiner-approval', { method: 'POST', headers, body: JSON.stringify({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, ...body, ...extra }) }), { params: Promise.resolve({ caseId: 'gus-case-010' }) });

afterEach(() => {
  caseFixtures[index] = original;
  session = { organizationId: GUS_CAMACHO_ORGANIZATION_ID, userId: 'identity-gus-director', role: 'funeralDirector' };
});

describe('/api/cases/[caseId]/medical-examiner-approval', () => {
  it('staff who can edit cases record it; the recorder comes from the session', async () => {
    caseFixtures[index] = { ...original, dateOfDeath: '01/01/2026' };
    const response = await post({ recordedBy: 'someone-else' });
    expect(response.status).toBe(200);
    expect((await response.json()).medicalExaminer.approval.recordedBy).toBe('identity-gus-director');
  });

  it('a read-only user, another organization and a cross-site request are refused; nothing is stored', async () => {
    session = { organizationId: GUS_CAMACHO_ORGANIZATION_ID, userId: 'identity-gus-viewer', role: 'readOnly' };
    expect((await post()).status).toBe(403);
    session = { organizationId: GUS_CAMACHO_ORGANIZATION_ID, userId: 'identity-gus-director', role: 'funeralDirector' };
    expect((await post({ organizationId: 'managed-cremations' })).status).toBe(403);
    expect((await post({}, { ...SAME_ORIGIN, origin: 'https://evil.example' })).status).toBe(403);
    expect(caseFixtures[index].crematory?.medicalExaminerApproval).toBeUndefined();
  });

  it('refuses a missing confirmation or reference', async () => {
    expect((await post({ confirmedInEdrs: undefined })).status).toBe(400);
    expect((await post({ confirmedInEdrs: false })).status).toBe(400);
  });
});
