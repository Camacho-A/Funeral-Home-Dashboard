import { afterEach, describe, expect, it } from 'vitest';
import {
  listCashAdvanceItems,
  createCashAdvanceItem,
  updateCashAdvanceItem,
  archiveCashAdvanceItem,
  sumCashAdvances,
  CashAdvanceServiceError,
} from './cashAdvanceService';
import { caseCashAdvanceItemFixtures } from './__mocks__/billingFixtures';

let n = 0;
const idFactory = () => `ca-${(n += 1)}`;
const ORG = 'org-1';
const CASE = 'case-1';

afterEach(() => {
  caseCashAdvanceItemFixtures.length = 0;
  n = 0;
});

describe('cashAdvanceService', () => {
  it('creates and lists active cash advance items, preserving the estimate + markup flags', async () => {
    await createCashAdvanceItem(
      { organizationId: ORG, caseId: CASE, description: 'Certified death certificates (5)', amountCents: 12500, hasMarkup: false, isEstimated: false, idFactory },
      'mock',
    );
    await createCashAdvanceItem(
      { organizationId: ORG, caseId: CASE, description: 'Obituary notice', amountCents: 20000, hasMarkup: true, isEstimated: true, idFactory },
      'mock',
    );
    const items = await listCashAdvanceItems(ORG, CASE, 'mock');
    expect(items).toHaveLength(2);
    // SOLIS ALL-CAPS data standard (2026-09): description is normalized on creation.
    const obit = items.find((i) => i.description === 'OBITUARY NOTICE')!;
    expect(obit.hasMarkup).toBe(true);
    expect(obit.isEstimated).toBe(true);
    expect(sumCashAdvances(items)).toBe(32500);
  });

  it('rejects a blank description or a negative/non-integer amount', async () => {
    await expect(
      createCashAdvanceItem({ organizationId: ORG, caseId: CASE, description: '  ', amountCents: 100, hasMarkup: false, isEstimated: false, idFactory }, 'mock'),
    ).rejects.toBeInstanceOf(CashAdvanceServiceError);
    await expect(
      createCashAdvanceItem({ organizationId: ORG, caseId: CASE, description: 'x', amountCents: -5, hasMarkup: false, isEstimated: false, idFactory }, 'mock'),
    ).rejects.toBeInstanceOf(CashAdvanceServiceError);
    await expect(
      createCashAdvanceItem({ organizationId: ORG, caseId: CASE, description: 'x', amountCents: 10.5, hasMarkup: false, isEstimated: false, idFactory }, 'mock'),
    ).rejects.toBeInstanceOf(CashAdvanceServiceError);
  });

  it('updates an item (e.g. estimate → known amount)', async () => {
    const created = await createCashAdvanceItem(
      { organizationId: ORG, caseId: CASE, description: 'Clergy honorarium', amountCents: 15000, hasMarkup: false, isEstimated: true, idFactory },
      'mock',
    );
    const updated = await updateCashAdvanceItem(ORG, CASE, created.id, { amountCents: 17500, isEstimated: false }, 'mock');
    expect(updated.amountCents).toBe(17500);
    expect(updated.isEstimated).toBe(false);
  });

  it('archives (soft-deletes) an item — it disappears from the active list', async () => {
    const created = await createCashAdvanceItem(
      { organizationId: ORG, caseId: CASE, description: 'Flowers', amountCents: 8000, hasMarkup: false, isEstimated: false, idFactory },
      'mock',
    );
    await archiveCashAdvanceItem(ORG, CASE, created.id, 'mock');
    expect(await listCashAdvanceItems(ORG, CASE, 'mock')).toHaveLength(0);
  });

  it('is tenant/case scoped — never returns another org or case', async () => {
    await createCashAdvanceItem({ organizationId: ORG, caseId: CASE, description: 'A', amountCents: 100, hasMarkup: false, isEstimated: false, idFactory }, 'mock');
    await createCashAdvanceItem({ organizationId: 'org-2', caseId: CASE, description: 'B', amountCents: 100, hasMarkup: false, isEstimated: false, idFactory }, 'mock');
    await createCashAdvanceItem({ organizationId: ORG, caseId: 'case-2', description: 'C', amountCents: 100, hasMarkup: false, isEstimated: false, idFactory }, 'mock');
    expect(await listCashAdvanceItems(ORG, CASE, 'mock')).toHaveLength(1);
  });
});
