import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from './__mocks__/pricingFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { getDashboard } from './dashboardService';

const NOW = '2026-07-20T12:00:00.000Z';

beforeEach(() => {
  activityEventFixtures.length = 0;
  ledgerAccountFixtures.length = 0;
  journalEntryFixtures.length = 0;
  journalEntryLineFixtures.length = 0;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
  paymentRecordFixtures.length = 0;
});

describe('getDashboard', () => {
  it('always computes today, regardless of permissions', async () => {
    const result = await getDashboard(DEFAULT_ORGANIZATION_ID, { identityId: 'identity-1', permissions: { canViewOperational: false, canViewFinancial: false } }, 'mock', NOW);
    expect(result.today).toBeDefined();
    expect(typeof result.today.unreadNotifications).toBe('number');
    expect(typeof result.today.appointmentsToday).toBe('number');
  });

  it('nulls out operations/financial/attention when the caller lacks both permissions', async () => {
    const result = await getDashboard(DEFAULT_ORGANIZATION_ID, { identityId: 'identity-1', permissions: { canViewOperational: false, canViewFinancial: false } }, 'mock', NOW);
    expect(result.operations).toBeNull();
    expect(result.financial).toBeNull();
    expect(result.attention).toBeNull();
  });

  it('computes operations + attention (but not financial) with only canViewOperational', async () => {
    const result = await getDashboard(DEFAULT_ORGANIZATION_ID, { identityId: 'identity-1', permissions: { canViewOperational: true, canViewFinancial: false } }, 'mock', NOW);
    expect(result.operations).not.toBeNull();
    expect(result.attention).not.toBeNull();
    expect(result.attention?.failedPayments).toBe(0); // withheld without canViewFinancial
    expect(result.financial).toBeNull();
  });

  it('computes financial with only canViewFinancial (operations/attention stay null)', async () => {
    const result = await getDashboard(DEFAULT_ORGANIZATION_ID, { identityId: 'identity-1', permissions: { canViewOperational: false, canViewFinancial: true } }, 'mock', NOW);
    expect(result.financial).not.toBeNull();
    expect(result.operations).toBeNull();
    expect(result.attention).toBeNull();
  });

  it('computes every section when both permissions are granted', async () => {
    const result = await getDashboard(DEFAULT_ORGANIZATION_ID, { identityId: 'identity-1', permissions: { canViewOperational: true, canViewFinancial: true } }, 'mock', NOW);
    expect(result.operations).not.toBeNull();
    expect(result.financial).not.toBeNull();
    expect(result.attention).not.toBeNull();
  });
});
