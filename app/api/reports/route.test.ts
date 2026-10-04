import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function getRequest(organizationId: string) {
  return GET(new Request(`http://localhost/api/reports?organizationId=${organizationId}`));
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
});

describe('GET /api/reports', () => {
  it('returns 400 without organizationId', async () => {
    expect((await GET(new Request('http://localhost/api/reports'))).status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns every report for an administrator, including financial ones', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reports.length).toBeGreaterThan(0);
    expect(body.reports.some((r: { key: string }) => r.key === 'trial-balance')).toBe(true);
    expect(body.reports.some((r: { key: string }) => r.key === 'active-cases')).toBe(true);
  });

  it('denies a caller with no report.view at all (officeStaff)', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });

  /**
   * Manors cleanup phase (Task #7, Reports audit). Manors has no
   * `enabledModules` configured at all (every pre-existing organization's
   * starting state) — `merchandise-performance`/`inventory-position`/
   * `accounts-payable` all carry `requiresModule`, so none of the three
   * should appear even for an administrator who holds every individual
   * report permission. This is a visibility decision, not a deletion —
   * the reports and their underlying services are untouched; they simply
   * don't surface for an organization that hasn't opted into that module.
   */
  it('hides reports whose underlying module Manors has not enabled (merchandise, inventory, accounts payable) even for an administrator', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    const keys = body.reports.map((r: { key: string }) => r.key);
    expect(keys).not.toContain('merchandise-performance');
    expect(keys).not.toContain('inventory-position');
    expect(keys).not.toContain('accounts-payable');
  });

  it('still returns every other report unaffected by module gating', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    const keys = body.reports.map((r: { key: string }) => r.key);
    expect(keys).toContain('active-cases');
    expect(keys).toContain('trial-balance');
    expect(keys).toContain('sla-exceptions');
  });
});

/**
 * Manors accounting/reports cleanup (2026-10). Manors (DEFAULT_ORGANIZATION_ID
 * === 'managed-cremations') has the Staff and Documents report categories
 * hidden via the `MANORS_ORGANIZATION_ID` override in
 * domain/organization/moduleVisibility.ts — a visibility decision, not a
 * deletion: the report definitions and underlying services are untouched,
 * they simply don't surface for this one organization. Operational and
 * Financial categories are explicitly unaffected.
 */
describe('GET /api/reports — Manors Staff/Documents category hiding (2026-10)', () => {
  it('hides every Staff-category report for Manors, even for an administrator', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    const keys = body.reports.map((r: { key: string }) => r.key);
    for (const staffReportKey of ['active-cases-by-staff', 'open-tasks-by-staff', 'appointment-load', 'case-ownership', 'workload-summary']) {
      expect(keys).not.toContain(staffReportKey);
    }
  });

  it('hides every Documents-category report for Manors, even for an administrator', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    const keys = body.reports.map((r: { key: string }) => r.key);
    for (const documentsReportKey of ['documents-generated', 'outstanding-signatures', 'signature-completion-time']) {
      expect(keys).not.toContain(documentsReportKey);
    }
  });

  it('does NOT hide Operational or Financial reports for Manors', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    const keys = body.reports.map((r: { key: string }) => r.key);
    for (const stillVisibleKey of ['active-cases', 'case-intake-volume', 'revenue-summary', 'general-ledger', 'trial-balance']) {
      expect(keys).toContain(stillVisibleKey);
    }
  });
});
