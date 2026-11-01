import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, MANORS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/identityFixtures';
import { GUS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/gusFixtures';
import { REPORT_REGISTRY, isReportVisibleForOrganization } from '@/domain/reporting/reportRegistry';
import { METRIC_REGISTRY } from '@/domain/reporting/metricRegistry';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';

/**
 * Gus UI review (2026-10): Reports "Staff" + "Documents & Signatures" and
 * Accounting Chart of Accounts / Journal Entries / Banking are hidden for
 * gus-camacho-jr — in navigation AND server-side (APIs answer 404). Manors'
 * historical behaviour (nav-only hiding) is unchanged.
 */

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: vi.fn(async () => undefined),
  clearSession: vi.fn(),
}));
let notFoundCalls = 0;
vi.mock('next/navigation', () => ({
  notFound: () => {
    notFoundCalls += 1;
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { createIdentitySession } = await import('@/services/sessionService');
const coa = await import('@/app/api/accounting/chart-of-accounts/route');
const journal = await import('@/app/api/accounting/journal-entries/route');
const bankAccounts = await import('@/app/api/accounting/banking/accounts/route');
const deposits = await import('@/app/api/accounting/banking/deposits/route');
const { guardHiddenModulePage } = await import('./hiddenModulePageGuard');
const metrics = await import('@/app/api/metrics/[metricKey]/route');
const transfers = await import('@/app/api/accounting/transfers/route');
const adjustments = await import('@/app/api/accounting/adjustments/route');
const writeOffs = await import('@/app/api/accounting/write-offs/route');
const reconciliations = await import('@/app/api/accounting/banking/reconciliations/route');

let n = 0;
async function signInAs(identityId: string) {
  const identity = identityFixtures.find((i) => i.id === identityId)!;
  const session = await createIdentitySession({ identityId, deviceId: 'hidden-modules-test', passwordVersionAtIssue: identity.passwordVersion, idFactory: () => `hm-${++n}` }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
}

const get = (handler: (r: Request) => Promise<Response>, path: string, org: string) =>
  handler(new Request(`http://localhost${path}?organizationId=${org}`));
const post = (handler: (r: Request) => Promise<Response>, path: string, body: unknown) =>
  handler(new Request(`http://localhost${path}`, { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body: JSON.stringify(body) }));

const handlerGet = (handler: (r: Request) => Promise<Response>, path: string, query: string) =>
  handler(new Request(`http://localhost${path}?${query}`));
const getMetric = (metricKey: string, org: string) =>
  metrics.GET(new Request(`http://localhost/api/metrics/${metricKey}?organizationId=${org}`), { params: Promise.resolve({ metricKey }) });
const JOURNAL_WRITES = [
  ['transfers', () => transfers.POST, { sourceAccountId: 'a', destinationAccountId: 'b', amountCents: 100, memo: 'Fictional' }],
  ['adjustments', () => adjustments.POST, { debitAccountId: 'a', creditAccountId: 'b', amountCents: 100, memo: 'Fictional' }],
  ['write-offs', () => writeOffs.POST, { caseId: 'gus-case-001', amountCents: 100, reason: 'Fictional' }],
] as const;

beforeEach(() => {
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  notFoundCalls = 0;
});

describe('Gus profile', () => {
  it('hides exactly the five modules, pinned, enforced server-side; Manors is not server-enforced', () => {
    const gus = getRegisteredOrganizationProfile(GUS);
    expect([...gus.features.hiddenModules].sort()).toEqual(
      ['accounting-banking', 'accounting-chart-of-accounts', 'accounting-journal-entries', 'reports-documents', 'reports-staff'].sort(),
    );
    expect(gus.pinnedFeatures).toContain('hiddenModules');
    expect(gus.features.enforceHiddenModulesServerSide).toBe(true);
    expect(getRegisteredOrganizationProfile(MANORS).features.enforceHiddenModulesServerSide).toBe(false);
  });
});

describe('Gus reports', () => {
  it('hides every Staff and Documents & Signatures report and keeps the rest', () => {
    const gus = { id: GUS, enabledModules: null, hiddenModules: null };
    for (const report of REPORT_REGISTRY) {
      const visible = isReportVisibleForOrganization(report, gus);
      if (report.category === 'staff' || report.category === 'documents') expect(visible, report.key).toBe(false);
      else if (!report.requiresModule) expect(visible, report.key).toBe(true);
    }
  });
});

describe('Gus accounting — server-side', () => {
  beforeEach(async () => {
    await signInAs(GUS_ADMIN_IDENTITY_ID);
  });

  it('refuses Journal Entries, Banking accounts and deposits (404)', async () => {
    expect((await get(journal.GET, '/api/accounting/journal-entries', GUS)).status).toBe(404);
    expect((await get(bankAccounts.GET, '/api/accounting/banking/accounts', GUS)).status).toBe(404);
    expect((await get(deposits.GET, '/api/accounting/banking/deposits', GUS)).status).toBe(404);
  });

  it('refuses creating ledger accounts (Chart of Accounts management) with 404', async () => {
    const response = await post(coa.POST, '/api/accounting/chart-of-accounts', {
      organizationId: GUS,
      accountNumber: '9999',
      name: 'Fictional',
      accountType: 'expense',
      normalBalance: 'debit',
    });
    expect(response.status).toBe(404);
  });

  it('still serves the account list that Accounting Reports needs (read-only)', async () => {
    expect((await get(coa.GET, '/api/accounting/chart-of-accounts', GUS)).status).toBe(200);
  });

  it('Phase 5C: refuses transfers, adjustments and write-offs (they post journal entries) with 404', async () => {
    for (const [name, handler, body] of JOURNAL_WRITES) {
      const response = await post(handler(), `/api/accounting/${name}`, { organizationId: GUS, ...body });
      expect(response.status, name).toBe(404);
    }
  });

  it('Phase 5C: refuses bank reconciliations with 404 whatever the reconciliation module says', async () => {
    expect((await handlerGet(reconciliations.GET, '/api/accounting/banking/reconciliations', `organizationId=${GUS}&bankAccountId=x`)).status).toBe(404);
    const response = await post(reconciliations.POST, '/api/accounting/banking/reconciliations', {
      organizationId: GUS, bankAccountId: 'x', statementEndingDate: '2026-01-31', statementEndingBalance: 0,
    });
    expect(response.status).toBe(404);
  });

  it('direct URLs to the hidden pages answer notFound()', async () => {
    for (const key of ['accounting-chart-of-accounts', 'accounting-journal-entries', 'accounting-banking'] as const) {
      await expect(guardHiddenModulePage(key)).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(notFoundCalls).toBe(3);
  });
});

describe('Gus metrics — Phase 5C', () => {
  beforeEach(async () => {
    await signInAs(GUS_ADMIN_IDENTITY_ID);
  });

  it('refuses every metric that only hidden Staff / Documents reports use', async () => {
    const hiddenOnly = METRIC_REGISTRY.map((m) => m.key).filter((key) => {
      const reports = REPORT_REGISTRY.filter((r) => (r.metrics as readonly string[]).includes(key));
      return reports.length > 0 && reports.every((r) => r.category === 'staff' || r.category === 'documents');
    });
    expect(hiddenOnly).toEqual(expect.arrayContaining(['staff.active_case_count', 'signatures.pending', 'documents.generated']));
    for (const key of hiddenOnly) {
      expect((await getMetric(key, GUS)).status, key).toBe(403);
    }
  });

  it('still serves metrics of visible reports', async () => {
    expect((await getMetric('cases.active', GUS)).status).toBe(200);
  });
});

describe('Manors (managed-cremations) is unaffected', () => {
  beforeEach(async () => {
    await signInAs(MANORS_ADMIN_IDENTITY_ID);
  });

  it('keeps API access and page access (nav-only hiding, as before)', async () => {
    expect((await get(journal.GET, '/api/accounting/journal-entries', MANORS)).status).toBe(200);
    expect((await get(bankAccounts.GET, '/api/accounting/banking/accounts', MANORS)).status).toBe(200);
    await expect(guardHiddenModulePage('accounting-journal-entries')).resolves.toBeUndefined();
    expect(notFoundCalls).toBe(0);
  });

  it('Phase 5C: transfers, adjustments and write-offs are not hidden for Manors', async () => {
    for (const [name, handler, body] of JOURNAL_WRITES) {
      const response = await post(handler(), `/api/accounting/${name}`, { organizationId: MANORS, ...body });
      expect(response.status, name).not.toBe(404);
    }
  });
});
