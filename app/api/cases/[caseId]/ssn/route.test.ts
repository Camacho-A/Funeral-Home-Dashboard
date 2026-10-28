import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

/** Case SSN correction route (2026-10): administrators only, with a reason; the number is never echoed. Fictional values. */
let session = { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'identity-admin', role: 'administrator' };
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (requested: string) =>
    requested !== session.organizationId
      ? { authorized: false, response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) }
      : { authorized: true, context: { organizationId: requested, userId: session.userId, role: session.role } },
  ),
}));
const permissions = vi.hoisted(() => ({ manage: true }));
vi.mock('@/services/authorizationPolicyService', async () => ({
  ...(await vi.importActual<object>('@/services/authorizationPolicyService')),
  canManageOrganization: vi.fn(async () => permissions.manage),
}));

const { POST } = await import('./route');
const { resetMockCaseSsn, readCaseSsn } = await import('@/services/caseSsnService');
const { caseFixtures } = await import('@/services/__mocks__/fixtures');

const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const params = { params: Promise.resolve({ caseId: '1042' }) };
const index = caseFixtures.findIndex((c) => c.id === '1042' && c.organizationId === DEFAULT_ORGANIZATION_ID);
const original = caseFixtures[index];
const post = (body: Record<string, unknown>, headers: Record<string, string> = SAME_ORIGIN) =>
  POST(new Request('http://localhost/api/cases/1042/ssn', { method: 'POST', headers, body: JSON.stringify({ organizationId: DEFAULT_ORGANIZATION_ID, ...body }) }), params);

beforeEach(() => {
  permissions.manage = true;
  resetMockCaseSsn();
});
afterEach(() => {
  caseFixtures[index] = original;
  session = { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'identity-admin', role: 'administrator' };
});

describe('POST /api/cases/[caseId]/ssn', () => {
  it('an administrator corrects it with a reason; only the last four come back', async () => {
    const response = await post({ ssn: '000-55-1111', reason: 'Typo on the Arrangement Form' });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ ssnOnFile: { last4: '1111', source: 'admin_correction' } });
    expect(text).not.toContain('000-55');
    expect((await readCaseSsn(DEFAULT_ORGANIZATION_ID, '1042', 'mock'))?.ssn).toBe('000-55-1111');
  });

  it('anyone else is refused — nothing changes', async () => {
    permissions.manage = false;
    const response = await post({ ssn: '000-55-1111', reason: 'Typo on the Arrangement Form' });
    expect(response.status).toBe(403);
    expect(await readCaseSsn(DEFAULT_ORGANIZATION_ID, '1042', 'mock')).toBeNull();
  });

  it('needs a reason without the number, and a 9-digit number; never echoes it', async () => {
    expect((await post({ ssn: '000-55-1111', reason: '' })).status).toBe(400);
    const withNumber = await post({ ssn: '000-55-1111', reason: 'should be 000-55-1111' });
    expect(withNumber.status).toBe(400);
    expect(await withNumber.text()).not.toContain('000-55-1111');
    const short = await post({ ssn: '1234', reason: 'Typo on the form' });
    expect(short.status).toBe(400);
    expect(await short.text()).not.toContain('1234');
  });

  it('refuses a cross-site request and another organization', async () => {
    expect((await post({ ssn: '000-55-1111', reason: 'Typo on the form' }, { ...SAME_ORIGIN, origin: 'https://evil.example' })).status).toBe(403);
    expect((await POST(new Request('http://localhost/x', { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ organizationId: 'other-org', ssn: '000-55-1111', reason: 'Typo on the form' }) }), params)).status).toBe(403);
  });
});
