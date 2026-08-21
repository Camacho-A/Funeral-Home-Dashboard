import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from './__mocks__/pricingFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { caseWriteOffFixtures, ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { merchandiseProductFixtures } from './__mocks__/merchandiseFixtures';
import { getAccountByNumber } from './chartOfAccountsService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import { assertJournalEntryBalances } from '../domain/ledger/balancing';

let idCounter = 0;
const idFactory = () => `id-${(idCounter += 1)}`;
const NOW = '2026-08-19T00:00:00.000Z';
const CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'identity-1', actorMembershipId: null, actorRoleKey: null, correlationId: 'corr-1' };

beforeEach(() => {
  idCounter = 0;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
  paymentRecordFixtures.length = 0;
  activityEventFixtures.length = 0;
  caseWriteOffFixtures.length = 0;
  ledgerAccountFixtures.length = 0;
  journalEntryFixtures.length = 0;
  journalEntryLineFixtures.length = 0;
  merchandiseProductFixtures.length = 0;
});

async function seedProduct(overrides: { retailPrice?: number; sku?: string; name?: string } = {}) {
  const { createProduct } = await import('./merchandiseService');
  return createProduct(
    {
      organizationId: DEFAULT_ORGANIZATION_ID,
      sku: overrides.sku ?? 'URN-OAK',
      name: overrides.name ?? 'Oak Urn',
      category: 'urn',
      cost: 15000,
      retailPrice: overrides.retailPrice ?? 39000,
      idFactory,
      now: NOW,
    },
    CTX,
    'mock',
  );
}

async function revenueLinesFor(caseId: string) {
  const ar = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, 'mock');
  const serviceRev = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.SERVICE_REVENUE, 'mock');
  const merchRev = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.MERCHANDISE_REVENUE, 'mock');
  const entryIds = new Set(journalEntryFixtures.filter((e) => e.sourceType === 'revenue_recognition' && e.caseId === caseId).map((e) => e.id));
  const lines = journalEntryLineFixtures.filter((l) => entryIds.has(l.journalEntryId));
  return { ar, serviceRev, merchRev, lines };
}

describe('createCaseOrder with merchandise', () => {
  it('produces a merchandise line item and splits revenue to Service (4000) and Merchandise (4100)', async () => {
    const { createCaseOrder } = await import('./pricingService');
    await seedProduct({ retailPrice: 39000 });
    const product = merchandiseProductFixtures[0];

    const { lineItems } = await createCaseOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-m1',
        selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false, merchandise: [{ productId: product.id, locationId: 'loc-1', quantity: 2 }] },
        performedBy: 'identity-1',
        idFactory,
        now: NOW,
      },
      'mock',
    );

    const merchLine = lineItems.find((li) => li.lineKind === 'merchandise');
    expect(merchLine).toBeDefined();
    expect(merchLine!.lineTotal).toBe(78000);
    expect(merchLine!.metadata).toMatchObject({ productId: product.id, sku: 'URN-OAK', locationId: 'loc-1' });
    expect(lineItems.some((li) => li.lineKind === 'service')).toBe(true);

    const { serviceRev, merchRev, lines } = await revenueLinesFor('case-m1');
    const serviceCredit = lines.filter((l) => l.accountId === serviceRev!.id && l.direction === 'credit').reduce((s, l) => s + l.amount, 0);
    const merchCredit = lines.filter((l) => l.accountId === merchRev!.id && l.direction === 'credit').reduce((s, l) => s + l.amount, 0);
    expect(serviceCredit).toBe(89000); // direct cremation
    expect(merchCredit).toBe(78000); // 2 × Oak Urn
  });

  it('every revenue_recognition entry balances', async () => {
    const { createCaseOrder } = await import('./pricingService');
    await seedProduct();
    const product = merchandiseProductFixtures[0];
    await createCaseOrder(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-m2', selections: { weightTier: '201_250', extraDeathCertificateQuantity: 1, mailCremated: true, merchandise: [{ productId: product.id, locationId: 'loc-1', quantity: 1 }] }, performedBy: 'identity-1', idFactory, now: NOW },
      'mock',
    );
    for (const entry of journalEntryFixtures) {
      const entryLines = journalEntryLineFixtures.filter((l) => l.journalEntryId === entry.id);
      expect(() => assertJournalEntryBalances(entryLines.map((l) => ({ direction: l.direction, amount: l.amount, accountId: l.accountId })))).not.toThrow();
    }
  });
});

describe('recalculateOrder preserves the untouched dimension', () => {
  it('a merchandise-only edit keeps the existing service lines and posts merchandise revenue only', async () => {
    const { createCaseOrder, recalculateOrder } = await import('./pricingService');
    await seedProduct({ retailPrice: 39000 });
    const product = merchandiseProductFixtures[0];

    await createCaseOrder(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-m3', selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false }, performedBy: 'identity-1', idFactory, now: NOW },
      'mock',
    );

    // Merchandise-only edit: NO service fields in the payload.
    const result = await recalculateOrder(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-m3', selections: { merchandise: [{ productId: product.id, locationId: 'loc-1', quantity: 1 }] }, performedBy: 'identity-1', idFactory, now: NOW },
      'mock',
    );
    expect(result).not.toBeNull();
    // Service line survived, merchandise line added.
    expect(result!.lineItems.some((li) => li.lineKind === 'service' && li.serviceCode === 'DIRECT_CREMATION')).toBe(true);
    expect(result!.lineItems.some((li) => li.lineKind === 'merchandise')).toBe(true);

    const { serviceRev, merchRev, lines } = await revenueLinesFor('case-m3');
    // Net service revenue credited across all entries is unchanged (89000);
    // the recalc entry touches only merchandise revenue.
    const serviceNet = lines.filter((l) => l.accountId === serviceRev!.id).reduce((s, l) => s + (l.direction === 'credit' ? l.amount : -l.amount), 0);
    const merchNet = lines.filter((l) => l.accountId === merchRev!.id).reduce((s, l) => s + (l.direction === 'credit' ? l.amount : -l.amount), 0);
    expect(serviceNet).toBe(89000);
    expect(merchNet).toBe(39000);
  });

  it('a service-only edit keeps the existing merchandise lines', async () => {
    const { createCaseOrder, recalculateOrder } = await import('./pricingService');
    await seedProduct({ retailPrice: 39000 });
    const product = merchandiseProductFixtures[0];

    const created = await createCaseOrder(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-m4', selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false, merchandise: [{ productId: product.id, locationId: 'loc-1', quantity: 1 }] }, performedBy: 'identity-1', idFactory, now: NOW },
      'mock',
    );
    const originalOrderId = created.order.id;

    // Service-only edit: NO merchandise key.
    const result = await recalculateOrder(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-m4', selections: { weightTier: '201_250', extraDeathCertificateQuantity: 0, mailCremated: false }, performedBy: 'identity-1', idFactory, now: NOW },
      'mock',
    );
    expect(result).not.toBeNull();
    // Merchandise line carried forward into the new version.
    expect(result!.lineItems.some((li) => li.lineKind === 'merchandise')).toBe(true);
    expect(result!.lineItems.some((li) => li.lineKind === 'service' && li.serviceCode.startsWith('WEIGHT_SURCHARGE'))).toBe(true);

    // Historical immutability: the original version's line items are untouched.
    const originalLines = caseOrderLineItemFixtures.filter((li) => li.caseOrderId === originalOrderId);
    expect(originalLines.some((li) => li.lineKind === 'merchandise' && li.lineTotal === 39000)).toBe(true);
  });
});
