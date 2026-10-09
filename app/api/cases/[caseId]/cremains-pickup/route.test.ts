import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { appointmentFixtures } from '@/services/__mocks__/schedulingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { POST, PATCH } = await import('./route');

/** A real mock case to hang pickups off — never a production record. */
const TEST_CASE_ID = '1044';

function request(method: 'POST' | 'PATCH', caseId: string, body: Record<string, unknown>) {
  const handler = method === 'POST' ? POST : PATCH;
  return handler(
    new Request(`http://localhost/api/cases/${caseId}/cremains-pickup`, {
      method,
      // `requireSameOrigin` compares the Origin's host against the Host
      // header, so both must be present and agree.
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}

let appointmentsBefore = 0;
beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  appointmentsBefore = appointmentFixtures.length;
});
afterEach(() => {
  appointmentFixtures.length = appointmentsBefore;
  activityEventFixtures.length = 0;
});

/**
 * Regression guard for the production save failure (2026-10).
 *
 * `casesService.get()` is a CLIENT-side accessor: in non-mock mode it
 * fetches the relative URL `/api/cases/{id}`, which has no origin to
 * resolve against inside a route handler and throws `Failed to parse URL`.
 * Calling it from this server route turned every save into a 500 that the
 * dialog could only report as "Could not save the expected pickup."
 */
describe('server-side case loading — the save-failure regression', () => {
  const ROUTE = 'app/api/cases/[caseId]/cremains-pickup/route.ts';

  function routeSource(): string {
    return fs.readFileSync(path.join(process.cwd(), ROUTE), 'utf8');
  }

  it('loads the case through Wix directly, never a relative fetch', () => {
    const code = routeSource();
    expect(code).toContain("queryWixDataItems<WixCaseItem>('cases'");
  });

  it('only ever reaches casesService in mock mode', () => {
    // Stripped of comments so the explanatory prose above the helper does
    // not satisfy the check on its own.
    const code = routeSource().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const calls = [...code.matchAll(/casesService\.get\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      expect(args, `casesService.get(${args}) must be mock-only`).toContain("'mock'");
    }
  });

  it('scopes the lookup to the authorized organization', () => {
    expect(routeSource()).toContain('organizationId,');
  });
});

describe('POST /api/cases/[caseId]/cremains-pickup', () => {
  it('creates a pickup on exactly the date given, and returns it', async () => {
    const response = await request('POST', TEST_CASE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      // Friday 2026-10-09 — the real B2026-035 scenario.
      expectedDate: '2026-10-09',
      notes: 'Crematory confirmed by phone.',
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.appointment.appointmentType).toBe('cremains.pickup.expected');
    expect(body.appointment.caseId).toBe(TEST_CASE_ID);
    expect(body.appointment.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    expect(body.appointment.status).toBe('scheduled');
    // Anchored to the organization's own midnight, not UTC's.
    expect(body.appointment.startAt.startsWith('2026-10-09')).toBe(true);
  });

  it('refuses a second pickup for the same case with a clear 409', async () => {
    await request('POST', TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, expectedDate: '2026-10-09' });
    const second = await request('POST', TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, expectedDate: '2026-10-13' });
    expect(second.status).toBe(409);
    expect((await second.json()).error).toMatch(/already has an expected cremains pickup/i);
    expect(appointmentFixtures.filter((a) => a.caseId === TEST_CASE_ID)).toHaveLength(1);
  });

  it('requires a reason for an off-schedule date, and says so machine-readably', async () => {
    // 2026-10-14 is a Wednesday.
    const response = await request('POST', TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, expectedDate: '2026-10-14' });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.requiresReason).toBe(true);
    expect(appointmentFixtures.length).toBe(appointmentsBefore);
  });

  it('accepts an off-schedule date once a reason is given, unchanged', async () => {
    const response = await request('POST', TEST_CASE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      expectedDate: '2026-10-14',
      reason: 'crematory called',
    });
    expect(response.status).toBe(201);
    expect((await response.json()).appointment.startAt.startsWith('2026-10-14')).toBe(true);
  });

  it('accepts a historical date exactly as entered', async () => {
    const response = await request('POST', TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, expectedDate: '2020-01-03' });
    expect(response.status).toBe(201);
    expect((await response.json()).appointment.startAt.startsWith('2020-01-03')).toBe(true);
  });

  it('rejects a malformed date', async () => {
    for (const expectedDate of ['10/09/2026', '2026-13-01', '', 'tomorrow']) {
      const response = await request('POST', TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, expectedDate });
      expect(response.status, String(expectedDate)).toBe(400);
    }
    expect(appointmentFixtures.length).toBe(appointmentsBefore);
  });

  it('rejects a missing organizationId', async () => {
    expect((await request('POST', TEST_CASE_ID, { expectedDate: '2026-10-09' })).status).toBe(400);
  });

  it('refuses an unauthenticated caller', async () => {
    mockSession = null;
    const response = await request('POST', TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, expectedDate: '2026-10-09' });
    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(appointmentFixtures.length).toBe(appointmentsBefore);
  });

  it('never reaches another organization\'s case', async () => {
    const response = await request('POST', TEST_CASE_ID, { organizationId: SECOND_MOCK_ORGANIZATION_ID, expectedDate: '2026-10-09' });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(appointmentFixtures.length).toBe(appointmentsBefore);
  });

  it('404s for a case that does not exist, without creating anything', async () => {
    const response = await request('POST', 'no-such-case', { organizationId: DEFAULT_ORGANIZATION_ID, expectedDate: '2026-10-09' });
    expect(response.status).toBe(404);
    expect(appointmentFixtures.length).toBe(appointmentsBefore);
  });

  it('changes no checklist state on the case', async () => {
    const before = JSON.stringify(caseFixtures.find((c) => c.id === TEST_CASE_ID)!.checklistState);
    await request('POST', TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, expectedDate: '2026-10-09' });
    expect(JSON.stringify(caseFixtures.find((c) => c.id === TEST_CASE_ID)!.checklistState)).toBe(before);
  });
});

describe('PATCH /api/cases/[caseId]/cremains-pickup', () => {
  it('re-dates the existing pickup rather than creating another', async () => {
    await request('POST', TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, expectedDate: '2026-10-09' });
    const response = await request('PATCH', TEST_CASE_ID, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      expectedDate: '2026-10-13',
      reason: 'crematory moved it',
    });
    expect(response.status).toBe(200);
    expect((await response.json()).appointment.startAt.startsWith('2026-10-13')).toBe(true);
    expect(appointmentFixtures.filter((a) => a.caseId === TEST_CASE_ID)).toHaveLength(1);
  });

  it('404s when there is no pickup to edit', async () => {
    const response = await request('PATCH', TEST_CASE_ID, { organizationId: DEFAULT_ORGANIZATION_ID, expectedDate: '2026-10-13' });
    expect(response.status).toBe(404);
  });
});
