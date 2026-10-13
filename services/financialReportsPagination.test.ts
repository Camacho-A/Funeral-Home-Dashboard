import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTrialBalance, getBalanceSheet, getProfitAndLoss } from './financialReportsService';
import { listJournalEntriesForOrganization, getAccountBalance } from './generalLedgerService';
import { listAccounts } from './chartOfAccountsService';

/**
 * Pagination of financial reads (2026-10 accounting audit).
 *
 * `queryWixDataItems` sends ONE request, and with no `paging` Wix applies
 * its own default page size — 50, verified against the live site — then
 * returns a truncated set with no error of any kind. A trial balance that
 * silently drops the 51st journal entry line still balances and still
 * looks correct.
 *
 * These exercise the REAL `queryAllWixDataItems` against a faked Wix
 * endpoint that pages exactly as Wix does, so what is under test is the
 * reports' own reads, end to end, at the volumes where truncation bites.
 */

const ENV_KEYS = ['WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

const ORG = 'org-pagination';
const OTHER_ORG = 'org-other';
const WIX_DEFAULT_PAGE_SIZE = 50;

function account(id: string, accountNumber: string, name: string, accountType: string, organizationId = ORG) {
  return {
    _id: id, beaconLedgerAccountId: id, organizationId, accountNumber,
    accountNumberKey: `${organizationId}:${accountNumber}`, name, accountType,
    normalBalance: accountType === 'asset' || accountType === 'expense' ? 'debit' : 'credit',
    parentAccountId: null, isSystemAccount: true, isActive: true, description: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const ACCOUNTS = [
  account('acct-ar', '1200', 'Accounts Receivable', 'asset'),
  account('acct-rev', '4000', 'Service Revenue', 'revenue'),
];

/** One balanced invoice per case: Dr Accounts Receivable / Cr Revenue. */
function ledgerOf(count: number, organizationId = ORG, amount = 1_000) {
  const entries = [];
  const lines = [];
  for (let i = 0; i < count; i++) {
    const id = `${organizationId}-entry-${i}`;
    entries.push({
      _id: id, beaconJournalEntryId: id, organizationId, entryNumber: `JE-${String(i).padStart(6, '0')}`,
      entryNumberKey: `${organizationId}:JE-${String(i).padStart(6, '0')}`,
      entryDate: `2026-0${(i % 9) + 1}-01T00:00:00.000Z`, status: 'posted', sourceType: 'revenue_recognition',
      sourceReferenceId: null, caseId: `case-${i}`, memo: `invoice ${i}`, reversesEntryId: null,
      postedAt: '2026-01-01T00:00:00.000Z', postedByStaffProfileId: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    lines.push(
      { _id: `${id}-l0`, beaconJournalEntryLineId: `${id}-l0`, organizationId, journalEntryId: id, accountId: 'acct-ar', direction: 'debit', amount, lineNumber: 0, caseId: `case-${i}`, description: null, createdAt: '2026-01-01T00:00:00.000Z' },
      { _id: `${id}-l1`, beaconJournalEntryLineId: `${id}-l1`, organizationId, journalEntryId: id, accountId: 'acct-rev', direction: 'credit', amount, lineNumber: 1, caseId: `case-${i}`, description: null, createdAt: '2026-01-01T00:00:00.000Z' },
    );
  }
  return { entries, lines };
}

/**
 * A Wix Data endpoint that pages exactly like the real one: it honours
 * `paging.limit`, defaults to 50 when none is given, and only advertises
 * `hasNext` while more remain. A caller that ignores the cursor gets a
 * silently truncated answer here, precisely as in production.
 */
function stubWix(collections: Record<string, unknown[]>) {
  const requests: Array<{ collection: string; limit: number | undefined; cursor: string | undefined }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      const { dataCollectionId, query } = JSON.parse(init.body);
      const rows = collections[dataCollectionId] ?? [];
      const filter = (query?.filter ?? {}) as Record<string, unknown>;
      const matching = rows.filter((row) =>
        Object.entries(filter).every(([key, value]) => (row as Record<string, unknown>)[key] === value),
      );
      const limit: number = query?.paging?.limit ?? WIX_DEFAULT_PAGE_SIZE;
      const offset = query?.paging?.cursor ? Number(query.paging.cursor) : 0;
      requests.push({ collection: dataCollectionId, limit: query?.paging?.limit, cursor: query?.paging?.cursor });
      const page = matching.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      const hasNext = nextOffset < matching.length;
      return {
        ok: true,
        json: async () => ({
          dataItems: page.map((data) => ({ id: (data as { _id: string })._id, dataCollectionId, data })),
          pagingMetadata: { hasNext, cursors: hasNext ? { next: String(nextOffset) } : {} },
        }),
      };
    }),
  );
  return requests;
}

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.WIX_API_KEY = 'test-key-value';
  process.env.WIX_SITE_ID = 'test-site-id';
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  vi.unstubAllGlobals();
});

describe('Trial Balance includes every entry regardless of volume', () => {
  // 49/50 sit either side of the page boundary; 51 and 120 are where an
  // un-paged read starts losing data.
  it.each([1, 49, 50, 51, 120, 250])('counts all %i invoices exactly once', async (count) => {
    const { entries, lines } = ledgerOf(count);
    stubWix({ journalEntries: entries, journalEntryLines: lines, chartOfAccounts: ACCOUNTS });

    const { rows, totalDebits, totalCredits } = await getTrialBalance(ORG, 'wix');

    expect(totalDebits).toBe(count * 1_000);
    expect(totalCredits).toBe(count * 1_000);
    expect(rows.find((r) => r.accountNumber === '1200')!.debitTotal).toBe(count * 1_000);
    expect(rows.find((r) => r.accountNumber === '4000')!.creditTotal).toBe(count * 1_000);
  });

  it('actually pages — a single request could not have returned 120 entries', async () => {
    const { entries, lines } = ledgerOf(120);
    const requests = stubWix({ journalEntries: entries, journalEntryLines: lines, chartOfAccounts: ACCOUNTS });

    await getTrialBalance(ORG, 'wix');

    const lineRequests = requests.filter((r) => r.collection === 'journalEntryLines');
    expect(lineRequests.length).toBeGreaterThan(1);
    expect(lineRequests.slice(1).every((r) => r.cursor !== undefined)).toBe(true);
  });

  it('counts nothing twice when the total lands exactly on a page boundary', async () => {
    // 50 entries = 100 lines = exactly two full pages of lines. An
    // off-by-one in the cursor would double-count the boundary row.
    const { entries, lines } = ledgerOf(50);
    stubWix({ journalEntries: entries, journalEntryLines: lines, chartOfAccounts: ACCOUNTS });

    const { totalDebits } = await getTrialBalance(ORG, 'wix');
    expect(totalDebits).toBe(50_000);
  });

  it('stays scoped to one organization across page boundaries', async () => {
    const mine = ledgerOf(80, ORG, 1_000);
    const theirs = ledgerOf(80, OTHER_ORG, 7_777);
    stubWix({
      journalEntries: [...mine.entries, ...theirs.entries],
      journalEntryLines: [...mine.lines, ...theirs.lines],
      chartOfAccounts: ACCOUNTS,
    });

    const { totalDebits } = await getTrialBalance(ORG, 'wix');
    expect(totalDebits).toBe(80_000);
  });

  it('applies the as-of date to the complete set, not just the first page', async () => {
    // Dates cycle across 9 months, so the entries inside the window are
    // spread through every page — a truncated read would miss most.
    const { entries, lines } = ledgerOf(120);
    stubWix({ journalEntries: entries, journalEntryLines: lines, chartOfAccounts: ACCOUNTS });

    const inWindow = entries.filter((e) => e.entryDate.slice(0, 10) <= '2026-06-01').length;
    const { totalDebits } = await getTrialBalance(ORG, 'wix', '2026-06-01');
    expect(totalDebits).toBe(inWindow * 1_000);
    expect(inWindow).toBeGreaterThan(WIX_DEFAULT_PAGE_SIZE);
  });
});

describe('Other financial reports read complete datasets', () => {
  it('Balance Sheet reflects every entry past the page boundary', async () => {
    const { entries, lines } = ledgerOf(120);
    stubWix({ journalEntries: entries, journalEntryLines: lines, chartOfAccounts: ACCOUNTS });

    const sheet = await getBalanceSheet(ORG, 'wix');
    const ar = sheet.assets.find((r) => r.accountNumber === '1200');
    expect(ar?.amount).toBe(120_000);
  });

  it('Income Statement reflects every entry past the page boundary', async () => {
    const { entries, lines } = ledgerOf(120);
    stubWix({ journalEntries: entries, journalEntryLines: lines, chartOfAccounts: ACCOUNTS });

    const pl = await getProfitAndLoss(ORG, 'wix');
    expect(pl.totalRevenue).toBe(120_000);
  });

  it('a single account balance sums every one of its lines', async () => {
    const { entries, lines } = ledgerOf(150);
    stubWix({ journalEntries: entries, journalEntryLines: lines, chartOfAccounts: ACCOUNTS });

    expect(await getAccountBalance(ORG, 'acct-ar', 'wix')).toBe(150_000);
  });

  it('the journal entry list returns every entry', async () => {
    const { entries, lines } = ledgerOf(140);
    stubWix({ journalEntries: entries, journalEntryLines: lines, chartOfAccounts: ACCOUNTS });

    expect((await listJournalEntriesForOrganization(ORG, 'wix')).length).toBe(140);
  });

  it('the chart of accounts returns every account', async () => {
    const many = Array.from({ length: 130 }, (_, i) => account(`acct-${i}`, String(1000 + i), `Account ${i}`, 'asset'));
    stubWix({ chartOfAccounts: many, journalEntries: [], journalEntryLines: [] });

    expect((await listAccounts(ORG, 'wix')).length).toBe(130);
  });
});
