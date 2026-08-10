import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  listAccounts,
  getAccountByNumber,
  createAccount,
  updateAccount,
  deactivateAccount,
  seedChartOfAccounts,
  ChartOfAccountsServiceError,
} from './chartOfAccountsService';
import type { ActivityContext } from './activityService';
import { ledgerAccountFixtures } from './__mocks__/ledgerFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `ledger-account-test-${idCounter}`;
}

function ctx(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    actorIdentityId: 'identity-1',
    actorMembershipId: 'membership-1',
    actorRoleKey: 'accounting',
    correlationId: 'corr-1',
    ...overrides,
  };
}

let lengths: { ledgerAccounts: number; activityEvents: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { ledgerAccounts: ledgerAccountFixtures.length, activityEvents: activityEventFixtures.length };
});
afterEach(() => {
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  activityEventFixtures.length = lengths.activityEvents;
});

describe('chartOfAccountsService', () => {
  describe('seedChartOfAccounts', () => {
    it('creates the starter chart for a brand-new organization', async () => {
      const { accounts, isNew } = await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
      expect(isNew).toBe(true);
      expect(accounts.length).toBeGreaterThan(0);
      expect(accounts.every((a) => a.organizationId === DEFAULT_ORGANIZATION_ID)).toBe(true);
      expect(accounts.every((a) => a.isSystemAccount)).toBe(true);
      expect(accounts.some((a) => a.accountNumber === '1200' && a.name === 'Accounts Receivable')).toBe(true);
    });

    it('is idempotent — a second call returns the existing chart unchanged, creating nothing new', async () => {
      const first = await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
      const second = await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
      expect(second.isNew).toBe(false);
      expect(second.accounts).toEqual(first.accounts);
    });

    it('seeds a second organization independently, never referencing the first organization\'s rows', async () => {
      await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
      const { accounts } = await seedChartOfAccounts(SECOND_MOCK_ORGANIZATION_ID, idFactory, 'mock');
      expect(accounts.every((a) => a.organizationId === SECOND_MOCK_ORGANIZATION_ID)).toBe(true);
      expect(accounts.some((a) => a.organizationId === DEFAULT_ORGANIZATION_ID)).toBe(false);
    });
  });

  describe('createAccount', () => {
    it('creates a custom account and records a financial activity event', async () => {
      const account = await createAccount(
        DEFAULT_ORGANIZATION_ID,
        { accountNumber: '1300', name: 'Prepaid Expenses', accountType: 'asset', normalBalance: 'debit', idFactory },
        ctx(),
        'mock',
      );
      expect(account.accountNumber).toBe('1300');
      expect(account.accountNumberKey).toBe(`${DEFAULT_ORGANIZATION_ID}:1300`);
      expect(account.isSystemAccount).toBe(false);
      expect(account.isActive).toBe(true);
      expect(activityEventFixtures.some((e) => e.category === 'financial' && e.resourceId === account.id)).toBe(true);
    });

    it('rejects a duplicate account number within the same organization', async () => {
      await createAccount(DEFAULT_ORGANIZATION_ID, { accountNumber: '1300', name: 'Prepaid A', accountType: 'asset', normalBalance: 'debit', idFactory }, ctx(), 'mock');
      await expect(
        createAccount(DEFAULT_ORGANIZATION_ID, { accountNumber: '1300', name: 'Prepaid B', accountType: 'asset', normalBalance: 'debit', idFactory }, ctx(), 'mock'),
      ).rejects.toThrow(ChartOfAccountsServiceError);
    });

    it('allows the same account number to be reused in a different organization', async () => {
      await createAccount(DEFAULT_ORGANIZATION_ID, { accountNumber: '1300', name: 'Prepaid A', accountType: 'asset', normalBalance: 'debit', idFactory }, ctx(), 'mock');
      await expect(
        createAccount(SECOND_MOCK_ORGANIZATION_ID, { accountNumber: '1300', name: 'Prepaid B', accountType: 'asset', normalBalance: 'debit', idFactory }, ctx({ organizationId: SECOND_MOCK_ORGANIZATION_ID }), 'mock'),
      ).resolves.toMatchObject({ accountNumber: '1300', organizationId: SECOND_MOCK_ORGANIZATION_ID });
    });

    it('rejects a child account whose accountType does not match its parent', async () => {
      const parent = await createAccount(DEFAULT_ORGANIZATION_ID, { accountNumber: '1400', name: 'Parent Asset', accountType: 'asset', normalBalance: 'debit', idFactory }, ctx(), 'mock');
      await expect(
        createAccount(
          DEFAULT_ORGANIZATION_ID,
          { accountNumber: '4100', name: 'Mismatched Child', accountType: 'revenue', normalBalance: 'credit', parentAccountId: parent.id, idFactory },
          ctx(),
          'mock',
        ),
      ).rejects.toThrow(/accountType/);
    });

    it('rejects a child account whose parent does not exist', async () => {
      await expect(
        createAccount(DEFAULT_ORGANIZATION_ID, { accountNumber: '1500', name: 'Orphan', accountType: 'asset', normalBalance: 'debit', parentAccountId: 'no-such-account', idFactory }, ctx(), 'mock'),
      ).rejects.toThrow(ChartOfAccountsServiceError);
    });

    it('allows a matching-type child account', async () => {
      const parent = await createAccount(DEFAULT_ORGANIZATION_ID, { accountNumber: '1600', name: 'Parent Asset', accountType: 'asset', normalBalance: 'debit', idFactory }, ctx(), 'mock');
      const child = await createAccount(
        DEFAULT_ORGANIZATION_ID,
        { accountNumber: '1610', name: 'Child Asset', accountType: 'asset', normalBalance: 'debit', parentAccountId: parent.id, idFactory },
        ctx(),
        'mock',
      );
      expect(child.parentAccountId).toBe(parent.id);
    });
  });

  describe('getAccountByNumber / getAccountById / listAccounts', () => {
    it('resolves an account by its plain, user-facing account number', async () => {
      await createAccount(DEFAULT_ORGANIZATION_ID, { accountNumber: '1700', name: 'Test Account', accountType: 'asset', normalBalance: 'debit', idFactory }, ctx(), 'mock');
      const found = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, '1700', 'mock');
      expect(found?.name).toBe('Test Account');
    });

    it('returns null for a nonexistent account number', async () => {
      expect(await getAccountByNumber(DEFAULT_ORGANIZATION_ID, '9999', 'mock')).toBeNull();
    });

    it('listAccounts scopes strictly to the given organization', async () => {
      await createAccount(DEFAULT_ORGANIZATION_ID, { accountNumber: '1800', name: 'Org A Account', accountType: 'asset', normalBalance: 'debit', idFactory }, ctx(), 'mock');
      await createAccount(SECOND_MOCK_ORGANIZATION_ID, { accountNumber: '1800', name: 'Org B Account', accountType: 'asset', normalBalance: 'debit', idFactory }, ctx({ organizationId: SECOND_MOCK_ORGANIZATION_ID }), 'mock');
      const orgAAccounts = await listAccounts(DEFAULT_ORGANIZATION_ID, 'mock');
      expect(orgAAccounts.every((a) => a.organizationId === DEFAULT_ORGANIZATION_ID)).toBe(true);
    });
  });

  describe('updateAccount', () => {
    it('updates name/description/parentAccountId without touching accountNumber/accountType', async () => {
      const account = await createAccount(DEFAULT_ORGANIZATION_ID, { accountNumber: '1900', name: 'Old Name', accountType: 'asset', normalBalance: 'debit', idFactory }, ctx(), 'mock');
      const updated = await updateAccount(DEFAULT_ORGANIZATION_ID, account.id, { name: 'New Name', description: 'Updated' }, 'mock');
      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('Updated');
      expect(updated.accountNumber).toBe('1900');
      expect(updated.accountType).toBe('asset');
    });

    it('throws for a nonexistent account', async () => {
      await expect(updateAccount(DEFAULT_ORGANIZATION_ID, 'no-such-account', { name: 'X' }, 'mock')).rejects.toThrow(ChartOfAccountsServiceError);
    });
  });

  describe('deactivateAccount', () => {
    it('deactivates a custom account and records a financial activity event', async () => {
      const account = await createAccount(DEFAULT_ORGANIZATION_ID, { accountNumber: '2000', name: 'Deactivatable', accountType: 'asset', normalBalance: 'debit', idFactory }, ctx(), 'mock');
      const deactivated = await deactivateAccount(DEFAULT_ORGANIZATION_ID, account.id, ctx(), 'mock');
      expect(deactivated.isActive).toBe(false);
      expect(activityEventFixtures.some((e) => e.category === 'financial' && e.resourceId === account.id && e.eventType.includes('deactivated'))).toBe(true);
    });

    it('refuses to deactivate a system (starter) account', async () => {
      const { accounts } = await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
      await expect(deactivateAccount(DEFAULT_ORGANIZATION_ID, accounts[0].id, ctx(), 'mock')).rejects.toThrow(/System accounts/);
    });

    it('throws for a nonexistent account', async () => {
      await expect(deactivateAccount(DEFAULT_ORGANIZATION_ID, 'no-such-account', ctx(), 'mock')).rejects.toThrow(ChartOfAccountsServiceError);
    });
  });
});
