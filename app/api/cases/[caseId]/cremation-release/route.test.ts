import { beforeEach, describe, expect, it, vi } from 'vitest';

/** POST /api/cases/[caseId]/cremation-release (Gus Phase 5K). */
const auth = vi.hoisted(() => ({ ok: true, canEdit: true }));
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (organizationId: string) =>
    auth.ok
      ? { authorized: true, context: { organizationId, userId: 'identity-gus-director', role: 'funeralDirector' } }
      : { authorized: false, response: new Response(JSON.stringify({ error: 'no' }), { status: 401 }) },
  ),
}));
vi.mock('@/lib/auth/csrf', () => ({ requireSameOrigin: () => null }));
vi.mock('@/lib/env', () => ({ getDataAdapterMode: () => 'mock' }));
vi.mock('@/services/authorizationPolicyService', () => ({ canEditCase: vi.fn(async () => auth.canEdit) }));
const approve = vi.hoisted(() => vi.fn());
vi.mock('@/services/cremationReleaseService', async () => {
  const actual = await vi.importActual<typeof import('@/services/cremationReleaseService')>('@/services/cremationReleaseService');
  return { ...actual, performReleaseAction: approve };
});
vi.mock('@/services/staffProfileService', () => ({ resolveStaffProfileForCaller: vi.fn(async () => ({ displayName: 'Jordan Demo' })) }));

const { POST } = await import('./route');
const { CremationReleaseError } = await import('@/services/cremationReleaseService');
const call = (body: unknown) => POST(new Request('http://localhost/api/cases/gus-case-010/cremation-release', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ caseId: 'gus-case-010' }) });

beforeEach(() => {
  Object.assign(auth, { ok: true, canEdit: true });
  approve.mockReset();
});

describe('POST cremation-release', () => {
  it('needs an explicit confirm, and nothing else from the body is used', async () => {
    expect((await call({ organizationId: 'gus-camacho-jr' })).status).toBe(400);
    approve.mockResolvedValue({ event: { eventId: 'r' }, status: 'released', evaluation: {} });
    const response = await call({ organizationId: 'gus-camacho-jr', confirm: true, approvedBy: 'someone-else', now: '2020-01-01' });
    expect(response.status).toBe(200);
    expect(approve).toHaveBeenCalledWith({ organizationId: 'gus-camacho-jr', userId: 'identity-gus-director', role: 'funeralDirector' }, 'gus-case-010', 'mock', { action: 'release', reason: null, actorName: 'Jordan Demo' });
  });

  it('passes a hold with its reason; refuses unknown actions and oversized reasons', async () => {
    approve.mockResolvedValue({ event: { eventId: 'h' }, status: 'on_hold', evaluation: {} });
    expect((await call({ organizationId: 'gus-camacho-jr', confirm: true, action: 'hold', reason: 'Family asked to wait' })).status).toBe(200);
    expect(approve.mock.calls[0][3]).toMatchObject({ action: 'hold', reason: 'Family asked to wait' });
    expect((await call({ organizationId: 'gus-camacho-jr', confirm: true, action: 'delete' })).status).toBe(400);
    expect((await call({ organizationId: 'gus-camacho-jr', confirm: true, action: 'hold', reason: 'x'.repeat(301) })).status).toBe(400);
  });

  it('passes the server’s refusal through — 423 while release is not active', async () => {
    approve.mockRejectedValue(new CremationReleaseError('Release for cremation is not active yet. Nothing was released.', 423));
    const response = await call({ organizationId: 'gus-camacho-jr', confirm: true });
    expect(response.status).toBe(423);
    expect((await response.json()).error).toMatch(/not active/);
  });

  it('refuses callers who may not change the case, before release is attempted', async () => {
    auth.canEdit = false;
    expect((await call({ organizationId: 'gus-camacho-jr', confirm: true })).status).toBe(403);
    auth.ok = false;
    expect((await call({ organizationId: 'gus-camacho-jr', confirm: true })).status).toBe(401);
    expect(approve).not.toHaveBeenCalled();
  });
});
