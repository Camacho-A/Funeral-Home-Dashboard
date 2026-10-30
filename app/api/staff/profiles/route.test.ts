import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { staffFixtures } from '@/services/__mocks__/fixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession, createSession: vi.fn() }));

const { GET } = await import('./route');

function getRequest(organizationId: string | null) {
  const url = organizationId ? `http://localhost/api/staff/profiles?organizationId=${organizationId}` : 'http://localhost/api/staff/profiles';
  return GET(new Request(url));
}

describe('GET /api/staff/profiles (2026-10)', () => {
  it('requires organizationId', async () => {
    expect((await getRequest(null)).status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
    mockSession = { user: mockDefaultUser };
  });

  it("returns 403 for an organization the caller isn't a member of — no other tenant's staff", async () => {
    expect((await getRequest(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it("returns only the organization's active staff profiles", async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const { staff } = (await response.json()) as { staff: { id: string; organizationId: string; isActive: boolean }[] };
    const expected = staffFixtures.filter((s) => s.organizationId === DEFAULT_ORGANIZATION_ID && s.isActive).map((s) => s.id);
    expect(staff.map((s) => s.id).sort()).toEqual([...expected].sort());
    expect(staff.length).toBeGreaterThan(0);
    expect(staff.every((s) => s.organizationId === DEFAULT_ORGANIZATION_ID && s.isActive)).toBe(true);
  });
});
