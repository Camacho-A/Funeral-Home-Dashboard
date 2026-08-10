import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from '@/services/__mocks__/ledgerFixtures';
import { bankDepositFixtures } from '@/services/__mocks__/bankingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { paymentRecordFixtures } from '@/services/__mocks__/paymentFixtures';
import { seedChartOfAccounts, getAccountByNumber } from '@/services/chartOfAccountsService';
import { STARTER_ACCOUNT_NUMBERS } from '@/domain/ledger/starterChartOfAccounts';
import type { PaymentRecord } from '@/types/payment';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `deposit-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET, POST } = await import('./route');

function getRequest(organizationId: string) {
  return GET(new Request(`http://localhost/api/accounting/banking/deposits?organizationId=${organizationId}`));
}
function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/accounting/banking/deposits', { method: 'POST', headers, body: JSON.stringify(body) }));
}

const NOW = '2026-08-01T00:00:00.000Z';
let lengths: { ledgerAccounts: number; journalEntries: number; journalEntryLines: number; bankDeposits: number; activityEvents: number; paymentRecords: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = {
    ledgerAccounts: ledgerAccountFixtures.length,
    journalEntries: journalEntryFixtures.length,
    journalEntryLines: journalEntryLineFixtures.length,
    bankDeposits: bankDepositFixtures.length,
    activityEvents: activityEventFixtures.length,
    paymentRecords: paymentRecordFixtures.length,
  };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
  const payment: PaymentRecord = {
    id: 'deposit-route-payment-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', caseOrderId: null,
    provider: 'clover', providerCheckoutId: 'checkout-1', providerPaymentId: 'provider-payment-1', idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
    checkoutUrl: null, status: 'succeeded', amount: 50_000, currency: 'usd', purpose: 'Fee',
    cardBrand: null, cardLast4: null, receiptReference: null, failureCode: null, failureMessage: null,
    createdAt: NOW, paidAt: NOW, updatedAt: NOW, initiatedByStaffProfileId: null, depositedInBankDepositId: null,
  };
  paymentRecordFixtures.push(payment);
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  journalEntryFixtures.length = lengths.journalEntries;
  journalEntryLineFixtures.length = lengths.journalEntryLines;
  bankDepositFixtures.length = lengths.bankDeposits;
  activityEventFixtures.length = lengths.activityEvents;
  paymentRecordFixtures.length = lengths.paymentRecords;
});

describe('GET /api/accounting/banking/deposits', () => {
  it('returns 403 for a role without accounting.view', async () => {
    mockSession = { user: mockMultiOrgUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns an empty list when no deposits exist', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deposits).toEqual([]);
  });
});

describe('POST /api/accounting/banking/deposits', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a role without accounting.post', async () => {
    mockSession = { user: mockMultiOrgUser };
    const cash = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, bankAccountLedgerAccountId: cash!.id, paymentIds: ['deposit-route-payment-1'] });
    expect(response.status).toBe(403);
  });

  it('sweeps the succeeded payment into a deposit', async () => {
    const cash = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, bankAccountLedgerAccountId: cash!.id, paymentIds: ['deposit-route-payment-1'] });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deposit.totalAmount).toBe(50_000);
  });
});
