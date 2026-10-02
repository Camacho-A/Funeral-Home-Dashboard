// @vitest-environment node
//
// This route reads a multipart FormData body (`request.formData()`).
// jsdom's `Request`/`FormData` polyfill (this project's global test
// `environment: 'jsdom'`) does not correctly auto-compute the
// `multipart/form-data; boundary=...` Content-Type the way Node's own
// native implementation does — confirmed empirically: under jsdom the
// same `new Request(url, { body: formData })` produces
// `content-type: text/plain;charset=UTF-8` instead, and
// `request.formData()` then throws "Content-Type was not one of
// multipart/form-data or application/x-www-form-urlencoded" regardless
// of what's actually in the body. Overriding to Node's own environment
// for just this file (not the global config) uses the real, correct
// implementation. This is very likely the same root cause behind
// `app/api/cases/[caseId]/documents/upload/route.test.ts`'s two
// previously-reported "pre-existing, unrelated" failures (expected
// 201/403, received 400 — the exact symptom of this bug) — flagged here
// rather than silently fixed there, since that file is outside this
// phase's scope.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMembershipFixtures } from '@/services/__mocks__/authFixtures';
import { organizationBrandingFixtures } from '@/services/__mocks__/onboardingFixtures';
import type { OrganizationBranding } from '@/types/organizationBranding';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const mockPut = vi.fn();
const mockDel = vi.fn();
vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => mockPut(...args),
  del: (...args: unknown[]) => mockDel(...args),
}));

const { POST, DELETE } = await import('./route');

function uploadRequest(formData: FormData, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/organization/branding/logo', { method: 'POST', headers, body: formData }));
}

function removeRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return DELETE(new Request('http://localhost/api/organization/branding/logo', { method: 'DELETE', headers, body: JSON.stringify(body) }));
}

function sampleFormData(overrides: { organizationId?: string; mimeType?: string; fileName?: string; bytes?: Uint8Array } = {}) {
  const formData = new FormData();
  formData.set('organizationId', overrides.organizationId ?? DEFAULT_ORGANIZATION_ID);
  const bytes = overrides.bytes ?? new Uint8Array([1, 2, 3]);
  formData.set('file', new File([bytes.buffer as ArrayBuffer], overrides.fileName ?? 'logo.png', { type: overrides.mimeType ?? 'image/png' }));
  return formData;
}

const ORIGINAL_BRANDING_STORE_ID = process.env.BLOB_BRANDING_STORE_ID;
const ORIGINAL_DOCUMENT_STORE_ID = process.env.BLOB_STORE_ID;

// Snapshotted by VALUE (not just array length) — `saveBranding`'s
// mock-mode branch mutates an existing fixture row IN PLACE
// (`organizationBrandingFixtures[index] = {...}`), so truncating the
// array back to its original length after a test leaves that row's
// mutated content behind for the next test. Full deep copy avoids that
// leak.
let brandingSnapshot: OrganizationBranding[];
beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  mockPut.mockReset();
  mockDel.mockReset();
  mockPut.mockResolvedValue({ url: 'https://example-blob.public.blob.vercel-storage.com/branding/managed-cremations/logo-abc123.png' });
  // The branding store's id must be configured for a normal upload to
  // succeed (corrected, OIDC-based production fix, 2026-10) — also set
  // the document store's own BLOB_STORE_ID alongside it in most tests,
  // specifically so a test asserting the branding path never targeted
  // the document store is actually proving something (see "never
  // targets the document store" below), not just testing an absent
  // fallback.
  process.env.BLOB_BRANDING_STORE_ID = 'store_branding_test_id';
  process.env.BLOB_STORE_ID = 'store_document_test_id';
  brandingSnapshot = organizationBrandingFixtures.map((b) => ({ ...b }));
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  if (ORIGINAL_BRANDING_STORE_ID === undefined) delete process.env.BLOB_BRANDING_STORE_ID;
  else process.env.BLOB_BRANDING_STORE_ID = ORIGINAL_BRANDING_STORE_ID;
  if (ORIGINAL_DOCUMENT_STORE_ID === undefined) delete process.env.BLOB_STORE_ID;
  else process.env.BLOB_STORE_ID = ORIGINAL_DOCUMENT_STORE_ID;
  organizationBrandingFixtures.length = 0;
  organizationBrandingFixtures.push(...brandingSnapshot);
});

describe('POST /api/organization/branding/logo', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await uploadRequest(sampleFormData(), { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await uploadRequest(sampleFormData())).status).toBe(401);
  });

  it('returns 400 when no file is provided', async () => {
    const formData = new FormData();
    formData.set('organizationId', DEFAULT_ORGANIZATION_ID);
    expect((await uploadRequest(formData)).status).toBe(400);
  });

  it('returns 400 for a missing organizationId', async () => {
    const formData = new FormData();
    formData.set('file', new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' }));
    expect((await uploadRequest(formData)).status).toBe(400);
  });

  it('rejects a non-image file type', async () => {
    const response = await uploadRequest(sampleFormData({ mimeType: 'application/pdf', fileName: 'not-a-logo.pdf' }));
    expect(response.status).toBe(400);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('rejects an unsupported image type (GIF)', async () => {
    const response = await uploadRequest(sampleFormData({ mimeType: 'image/gif', fileName: 'logo.gif' }));
    expect(response.status).toBe(400);
  });

  it('rejects an oversized file', async () => {
    const response = await uploadRequest(sampleFormData({ bytes: new Uint8Array(5 * 1024 * 1024 + 1) }));
    expect(response.status).toBe(400);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('rejects an empty file', async () => {
    const response = await uploadRequest(sampleFormData({ bytes: new Uint8Array(0) }));
    expect(response.status).toBe(400);
  });

  it("a role without organization.manage (readOnly) cannot upload", async () => {
    const readOnlyUser = { id: 'mock-user-readonly-branding-test', email: 'readonly-branding@beacon.test', displayName: 'Read Only Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: readOnlyUser.id, role: 'readOnly', isActive: true });
    mockSession = { user: readOnlyUser };

    const response = await uploadRequest(sampleFormData());
    expect(response.status).toBe(403);
    expect(mockPut).not.toHaveBeenCalled();

    mockMembershipFixtures.pop();
  });

  /**
   * Organization Branding Settings phase — required multi-tenant test.
   * `mockDefaultUser` is an administrator of `managed-cremations` only;
   * they have NO membership in `evergreen-memorial-group`. Naming the
   * other organization's id in the request must not grant access to it —
   * `requireAuthorizedOrganization` re-resolves from the caller's own
   * session/membership, never trusting the client-supplied value.
   */
  it('an administrator of Organization A cannot modify Organization B\'s branding by naming it in the request', async () => {
    const response = await uploadRequest(sampleFormData({ organizationId: SECOND_MOCK_ORGANIZATION_ID }));
    expect(response.status).toBe(403);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('an authorized administrator can upload a logo, which persists to OrganizationBranding.logoUrl', async () => {
    const response = await uploadRequest(sampleFormData());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.branding.logoUrl).toBe('https://example-blob.public.blob.vercel-storage.com/branding/managed-cremations/logo-abc123.png');
    expect(mockPut).toHaveBeenCalledTimes(1);
    const [key, , options] = mockPut.mock.calls[0];
    expect(key).toMatch(/^branding\/managed-cremations\/logo-.+\.png$/);
    expect(options).toMatchObject({ access: 'public', contentType: 'image/png' });

    const stored = organizationBrandingFixtures.find((b) => b.organizationId === DEFAULT_ORGANIZATION_ID);
    expect(stored?.logoUrl).toBe('https://example-blob.public.blob.vercel-storage.com/branding/managed-cremations/logo-abc123.png');
  });

  /**
   * Production incident fix (2026-10), corrected to Vercel's current
   * OIDC architecture — the exact bug this corrects: "Vercel Blob:
   * Cannot use public access on a private store." Proves the upload call
   * site targets the BRANDING store by its own storeId, not the (also-
   * configured, in this test) document store's storeId, and uses no
   * static token at all.
   */
  it('targets the branding store (BLOB_BRANDING_STORE_ID), never the document store, even when both store ids are configured', async () => {
    await uploadRequest(sampleFormData());
    const [, , options] = mockPut.mock.calls[0];
    expect(options.storeId).toBe('store_branding_test_id');
    expect(options.storeId).not.toBe('store_document_test_id');
    expect(options.token).toBeUndefined();
  });

  /**
   * Production incident fix (2026-10) — fail-safe behavior: a missing
   * branding store id must be a clear, distinct configuration error,
   * never a silent fallback to the document store (which would just
   * reintroduce the original bug) and never a generic/opaque failure.
   */
  it('returns a clear 503 configuration error, and never calls put(), when the branding store id is not configured', async () => {
    delete process.env.BLOB_BRANDING_STORE_ID;
    const response = await uploadRequest(sampleFormData());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toContain('BLOB_BRANDING_STORE_ID');
    expect(body.error).not.toContain('store_document_test_id'); // never leaks the document store id either
    expect(mockPut).not.toHaveBeenCalled();

    // Still unconfigured in the branding record — a config error must
    // never half-persist a result.
    const stored = organizationBrandingFixtures.find((b) => b.organizationId === DEFAULT_ORGANIZATION_ID);
    expect(stored?.logoUrl).not.toMatch(/vercel-storage\.com/);
  });

  it('a Blob upload failure is reported as an error, never a false success', async () => {
    mockPut.mockRejectedValue(new Error('network error'));
    const response = await uploadRequest(sampleFormData());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toMatch(/Logo upload failed/);
  });
});

describe('DELETE /api/organization/branding/logo', () => {
  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await removeRequest({ organizationId: DEFAULT_ORGANIZATION_ID })).status).toBe(401);
  });

  it('returns 400 for an invalid payload (missing organizationId)', async () => {
    expect((await removeRequest({})).status).toBe(400);
  });

  it("a role without organization.manage (readOnly) cannot remove the logo", async () => {
    const readOnlyUser = { id: 'mock-user-readonly-branding-remove-test', email: 'readonly-branding-remove@beacon.test', displayName: 'Read Only Test User', source: 'mock' as const };
    mockMembershipFixtures.push({ organizationId: DEFAULT_ORGANIZATION_ID, userId: readOnlyUser.id, role: 'readOnly', isActive: true });
    mockSession = { user: readOnlyUser };

    const response = await removeRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);

    mockMembershipFixtures.pop();
  });

  it('an administrator of Organization A cannot remove Organization B\'s logo', async () => {
    const response = await removeRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });

  it('an authorized administrator can remove the logo, clearing logoUrl to null', async () => {
    const existingIndex = organizationBrandingFixtures.findIndex((b) => b.organizationId === DEFAULT_ORGANIZATION_ID);
    organizationBrandingFixtures[existingIndex] = { ...organizationBrandingFixtures[existingIndex], logoUrl: 'https://example.com/old-logo.png' };

    const response = await removeRequest({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.branding.logoUrl).toBeNull();
    expect(mockDel).not.toHaveBeenCalled(); // deliberately never deletes the underlying blob — see service's own comment
  });
});
