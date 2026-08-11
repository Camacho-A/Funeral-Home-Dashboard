import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from './__mocks__/pricingFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { exportReportCsv } from './reportExportService';

beforeEach(() => {
  ledgerAccountFixtures.length = 0;
  journalEntryFixtures.length = 0;
  journalEntryLineFixtures.length = 0;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
  paymentRecordFixtures.length = 0;
  activityEventFixtures.length = 0;
});

describe('exportReportCsv', () => {
  it('exports a metrics-kind report as one row per metric, header first', async () => {
    const csv = await exportReportCsv(DEFAULT_ORGANIZATION_ID, 'active-cases', {}, 'mock');
    const lines = csv.split('\n');
    expect(lines[0]).toBe('metricKey,displayName,value');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.some((l) => l.startsWith('cases.active,'))).toBe(true);
  });

  it('JSON-encodes an array-valued metric into a single cell', async () => {
    const csv = await exportReportCsv(DEFAULT_ORGANIZATION_ID, 'active-cases', {}, 'mock');
    const stageRow = csv.split('\n').find((l) => l.startsWith('cases.stage.count,'));
    expect(stageRow).toBeDefined();
    // The JSON value contains a comma, so buildCsv must have quoted the whole cell.
    expect(stageRow).toMatch(/"\[.*\]"/);
  });

  it('exports a financial-kind report (trial balance) using its own row shape', async () => {
    // The trial balance only lists accounts with posted activity — seeding
    // the chart of accounts alone yields zero rows, so this test posts a
    // real case order (which now triggers revenue recognition) first.
    const { createCaseOrder } = await import('./pricingService');
    await createCaseOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-export-trial-balance',
        selections: { weightTier: '201_250', extraDeathCertificateQuantity: 1, mailCremated: false },
        performedBy: 'Jordan Ellis',
        idFactory: () => `tb-export-${Math.random()}`,
        now: '2026-07-20T00:00:00.000Z',
      },
      'mock',
    );
    const csv = await exportReportCsv(DEFAULT_ORGANIZATION_ID, 'trial-balance', {}, 'mock');
    const lines = csv.split('\n');
    expect(lines[0]).toBe('accountNumber,accountName,accountType,debitTotal,creditTotal');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('flattens balance-sheet assets/liabilities/equity into one CSV with a section column', async () => {
    const { seedChartOfAccounts } = await import('./chartOfAccountsService');
    await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, () => `bs-export-${Math.random()}`, 'mock');
    const csv = await exportReportCsv(DEFAULT_ORGANIZATION_ID, 'balance-sheet', {}, 'mock');
    expect(csv.split('\n')[0]).toBe('section,accountNumber,accountName,amount');
  });

  it('throws when the general-ledger export is requested without an accountId', async () => {
    await expect(exportReportCsv(DEFAULT_ORGANIZATION_ID, 'general-ledger', {}, 'mock')).rejects.toThrow(/accountId/);
  });

  it('throws for an unknown report key', async () => {
    await expect(exportReportCsv(DEFAULT_ORGANIZATION_ID, 'not-a-report', {}, 'mock')).rejects.toThrow();
  });
});
