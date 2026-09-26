import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

/**
 * TEMPORARY diagnostic (2026-09) — Vercel Blob connectivity check. Mirrors
 * app/api/rbac/roles/route.test.ts's identity-mode `seedCaller` pattern for
 * real RBAC resolution. `checkBlobConnectivity` itself (key generation,
 * fixed content, upload/delete/error-categorization) is exercised by
 * services/documentService.test.ts — this file only proves authorization
 * gating and that the route maps that function's result to the correct
 * sanitized response shape.
 */

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `blob-diagnostic-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: vi.fn(),
  clearSession: vi.fn(),
}));

let mockCheckBlobConnectivity = vi.fn();
vi.mock('@/services/documentService', () => ({
  checkBlobConnectivity: () => mockCheckBlobConnectivity(),
}));

const { POST } = await import('./route');

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost', 'Content-Type': 'application/json' }) {
  return POST(new Request('http://localhost/api/diagnostics/blob-connectivity', { method: 'POST', headers, body: JSON.stringify(body) }));
}

let lengths: { identity: number; membership: number; sessions: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  mockCheckBlobConnectivity = vi.fn().mockResolvedValue({ configured: true, upload: 'success', delete: 'success' });
  lengths = { identity: identityFixtures.length, membership: membershipFixtures.length, sessions: identitySessionFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  vi.clearAllMocks();
});

async function seedCaller(role: string) {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { createMembership } = await import('@/services/membershipService');
  const { createIdentitySession } = await import('@/services/sessionService');
  const { identity } = await findOrCreateIdentity({ email: `caller-${idFactory()}@example.com`, displayName: 'Caller', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role, status: 'active', invitedBy: null, idFactory }, 'mock');
  const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', passwordVersionAtIssue: 0, idFactory }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
  return identity;
}

describe('POST /api/diagnostics/blob-connectivity', () => {
  it('returns 401 with no session', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(401);
    expect(mockCheckBlobConnectivity).not.toHaveBeenCalled();
  });

  it('returns 400 with no organizationId', async () => {
    await seedCaller('administrator');
    const response = await postRequest({});
    expect(response.status).toBe(400);
  });

  it('rejects a cross-origin request (CSRF)', async () => {
    await seedCaller('administrator');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'http://evil.example', host: 'localhost', 'Content-Type': 'application/json' });
    expect(response.status).toBe(403);
    expect(mockCheckBlobConnectivity).not.toHaveBeenCalled();
  });

  it('a readOnly caller is refused — not an administrator', async () => {
    await seedCaller('readOnly');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
    expect(mockCheckBlobConnectivity).not.toHaveBeenCalled();
  });

  it('an officeStaff caller is refused — not an administrator', async () => {
    await seedCaller('officeStaff');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });

  it('an administrator succeeds and the route reflects checkBlobConnectivity\'s success result', async () => {
    await seedCaller('administrator');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: true, upload: 'success', delete: 'success', cleanup: 'success' });
    expect(mockCheckBlobConnectivity).toHaveBeenCalledTimes(1);
  });

  it('reports configured: false when the token is absent', async () => {
    await seedCaller('administrator');
    mockCheckBlobConnectivity.mockResolvedValue({ configured: false });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(await response.json()).toEqual({ configured: false, upload: 'skipped', delete: 'skipped', cleanup: 'skipped' });
  });

  it('reflects a sanitized upload failure without leaking the underlying error', async () => {
    await seedCaller('administrator');
    mockCheckBlobConnectivity.mockResolvedValue({ configured: true, upload: 'failed', delete: 'skipped', errorCategory: 'not_configured' });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body).toEqual({ configured: true, upload: 'failed', delete: 'skipped', cleanup: 'failed', errorCategory: 'not_configured' });
  });

  it('reflects a sanitized delete failure after a successful upload', async () => {
    await seedCaller('administrator');
    mockCheckBlobConnectivity.mockResolvedValue({ configured: true, upload: 'success', delete: 'failed', errorCategory: 'storage_provider_error' });
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(body).toEqual({ configured: true, upload: 'success', delete: 'failed', cleanup: 'failed', errorCategory: 'storage_provider_error' });
  });

  it('never accepts a client-supplied key or content — request body fields other than organizationId are ignored', async () => {
    await seedCaller('administrator');
    await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, key: 'attacker-chosen-key.txt', content: 'not this' });
    // checkBlobConnectivity takes no arguments at all — nothing from the body can reach it.
    expect(mockCheckBlobConnectivity).toHaveBeenCalledWith();
  });

  it('never returns a token or secret-shaped value in any response', async () => {
    await seedCaller('administrator');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/vercel_blob_rw_|BLOB_READ_WRITE_TOKEN/i);
  });
});
