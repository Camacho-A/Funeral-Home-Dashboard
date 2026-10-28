import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

/** Case SSN one-time fill route (2026-10): administrators only; dryRun required. Service simulated. */
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (requested: string) => ({ authorized: true, context: { organizationId: requested, userId: 'identity-admin', role: 'administrator' } })),
}));
const permissions = vi.hoisted(() => ({ manage: true }));
vi.mock('@/services/authorizationPolicyService', async () => ({
  ...(await vi.importActual<object>('@/services/authorizationPolicyService')),
  canManageOrganization: vi.fn(async () => permissions.manage),
}));
const backfill = vi.hoisted(() => vi.fn());
vi.mock('@/services/caseSsnService', async () => ({ ...(await vi.importActual<object>('@/services/caseSsnService')), backfillCaseSsns: backfill }));

const { POST } = await import('./route');
const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const post = (body: Record<string, unknown>, headers: Record<string, string> = SAME_ORIGIN) =>
  POST(new Request('http://localhost/api/organization/case-ssn/backfill', { method: 'POST', headers, body: JSON.stringify({ organizationId: DEFAULT_ORGANIZATION_ID, ...body }) }));

beforeEach(() => {
  permissions.manage = true;
  backfill.mockReset().mockResolvedValue({ dryRun: true, checked: 2, counts: { would_save: 1, saved: 0, already_on_file: 1, none_found: 0 }, cases: [] });
});

describe('POST /api/organization/case-ssn/backfill', () => {
  it('runs the preview or the fill exactly as asked', async () => {
    expect((await post({ dryRun: true })).status).toBe(200);
    expect(backfill.mock.calls[0][1]).toEqual({ dryRun: true });
    await post({ dryRun: false });
    expect(backfill.mock.calls[1][1]).toEqual({ dryRun: false });
  });

  it('dryRun must be stated — never a fill by default', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ dryRun: 'no' })).status).toBe(400);
    expect(backfill).not.toHaveBeenCalled();
  });

  it('administrators only; same-origin only', async () => {
    permissions.manage = false;
    expect((await post({ dryRun: false })).status).toBe(403);
    permissions.manage = true;
    expect((await post({ dryRun: false }, { ...SAME_ORIGIN, origin: 'https://evil.example' })).status).toBe(403);
    expect(backfill).not.toHaveBeenCalled();
  });
});
