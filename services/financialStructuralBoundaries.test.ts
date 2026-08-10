import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, sep } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 31 (Financial Management & General Ledger). The structural tests
 * promised throughout this phase's implementation, gathered in one file
 * mirroring `services/portal/portalStructuralBoundaries.test.ts`'s exact
 * pattern: "only the designated service writes to each new collection,"
 * "only activityService.ts's own record* builders construct a `financial`
 * category event," and "no accounting route/UI file touches Wix directly."
 */
const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

function walk(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, results);
    } else if (['.ts', '.tsx'].includes(extname(fullPath)) && !fullPath.endsWith('.test.ts') && !fullPath.endsWith('.test.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

const root = join(__dirname, '..');
const allFiles = walk(root);

describe('Financial collection writers (structural)', () => {
  const writers: Record<string, string> = {
    chartOfAccounts: join(__dirname, 'chartOfAccountsService.ts'),
    journalEntries: join(__dirname, 'generalLedgerService.ts'),
    journalEntryLines: join(__dirname, 'generalLedgerService.ts'),
    bankAccounts: join(__dirname, 'bankingService.ts'),
    bankStatementImports: join(__dirname, 'bankingService.ts'),
    bankStatementLines: join(__dirname, 'bankingService.ts'),
    bankReconciliations: join(__dirname, 'bankingService.ts'),
    // Both created by the same one-shot transaction functions in
    // financialTransactionService.ts (postWriteOffTransaction,
    // postDepositTransaction) — not bankingService.ts, which owns account
    // management/statement import/reconciliation but never deposit
    // creation (see BankingPanel.tsx's own comment on this split).
    caseWriteOffs: join(__dirname, 'financialTransactionService.ts'),
    bankDeposits: join(__dirname, 'financialTransactionService.ts'),
    // Modified, not new, collections (conflict #5 / refund cash-location
    // fields) — confirming the phase's new fields didn't introduce a
    // second writer alongside each collection's existing one.
    caseOrders: join(__dirname, 'pricingService.ts'),
    paymentRecords: join(__dirname, 'paymentsService.ts'),
  };

  for (const [collection, writerPath] of Object.entries(writers)) {
    it(`only ${writerPath.split(sep).pop()} writes to "${collection}" directly`, () => {
      const writePattern = new RegExp(`(?:insertWixDataItem|updateWixDataItem)(?:<[^>]*>)?\\(\\s*['"]${collection}['"]`);
      const offenders = allFiles.filter((filePath) => filePath !== writerPath && writePattern.test(readFileSync(filePath, 'utf8')));
      expect(offenders, `unexpected writer(s) of "${collection}": ${offenders.join(', ')}`).toEqual([]);
    });
  }
});

describe('Financial activity-event emitter boundary (structural)', () => {
  const activityServicePath = join(__dirname, 'activityService.ts');

  // The 12 event types introduced for the new 'financial'
  // ActivityEventCategory (see types/activityEvent.ts) — each must be
  // constructed only by its dedicated record* builder in
  // activityService.ts, never re-implemented inline by a caller
  // (which would bypass ActivityService's own persistence/error handling).
  const financialEventTypeKeys = [
    'JOURNAL_ENTRY_POSTED',
    'JOURNAL_ENTRY_REVERSED',
    'JOURNAL_ENTRY_VOIDED',
    'LEDGER_ACCOUNT_CREATED',
    'LEDGER_ACCOUNT_DEACTIVATED',
    'CASE_WRITE_OFF_POSTED',
    'FINANCIAL_ADJUSTMENT_POSTED',
    'BANK_DEPOSIT_POSTED',
    'FUNDS_TRANSFER_POSTED',
    'BANK_STATEMENT_IMPORTED',
    'BANK_RECONCILIATION_STARTED',
    'BANK_RECONCILIATION_COMPLETED',
  ];

  for (const key of financialEventTypeKeys) {
    it(`only activityService.ts references ACTIVITY_EVENT_TYPES.${key}`, () => {
      const referencePattern = new RegExp(`ACTIVITY_EVENT_TYPES\\.${key}\\b`);
      const offenders = allFiles.filter((filePath) => filePath !== activityServicePath && referencePattern.test(readFileSync(filePath, 'utf8')));
      expect(offenders, `unexpected reference(s) to ACTIVITY_EVENT_TYPES.${key}: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  it('postRefundTransaction reuses the existing recordPaymentRefunded builder rather than a competing one', () => {
    // PAYMENT_REFUNDED ('payment.refunded', category 'payments') was
    // reserved since before this phase — financialTransactionService.ts
    // gives it its first real emitter here rather than introducing a
    // second, duplicate "refund happened" event type.
    const filePath = join(__dirname, 'financialTransactionService.ts');
    const content = readFileSync(filePath, 'utf8');
    expect(/\brecordPaymentRefunded\b/.test(content)).toBe(true);
  });
});

describe('Financial UI/route no-direct-Wix boundary (structural)', () => {
  const refundRouteSegment = join('app', 'api', 'cases', '[caseId]', 'payments', '[paymentId]', 'refund');
  const financialSurfaceFiles = allFiles.filter(
    (filePath) =>
      filePath.includes(`${sep}app${sep}api${sep}accounting${sep}`) ||
      filePath.includes(refundRouteSegment) ||
      filePath.includes(`${sep}components${sep}accounting${sep}`) ||
      filePath.endsWith(`${sep}hooks${sep}useAccounting.ts`) ||
      filePath.endsWith(`${sep}lib${sep}accountingClient.ts`),
  );

  it('found at least one financial surface file to check (sanity check on the walk itself)', () => {
    expect(financialSurfaceFiles.length).toBeGreaterThan(0);
  });

  it('no financial route/UI/client file imports lib/wixDataApi or calls its functions directly', () => {
    const forbiddenPattern = /from ['"][^'"]*wixDataApi['"]|(?:insertWixDataItem|updateWixDataItem|queryWixDataItems)\s*\(/;
    const offenders = financialSurfaceFiles.filter((filePath) => forbiddenPattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders, `file(s) touching Wix Data directly: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('Phase 31: hard layering invariant extension — no *IdentityId field on new financial types', () => {
  const financialTypeFiles = [
    'ledgerAccount.ts',
    'journalEntry.ts',
    'bankAccount.ts',
    'bankDeposit.ts',
    'bankStatement.ts',
    'bankReconciliation.ts',
    'caseWriteOff.ts',
  ];

  for (const fileName of financialTypeFiles) {
    it(`${fileName} declares no forbidden *IdentityId field`, () => {
      const source = readFileSync(join(root, 'types', fileName), 'utf8');
      const fieldPattern = /^\s*(\w+)\??:\s*/gm;
      const offenders: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = fieldPattern.exec(source)) !== null) {
        const fieldName = match[1];
        if (fieldName.endsWith('IdentityId')) offenders.push(fieldName);
      }
      expect(offenders).toEqual([]);
    });
  }

  it("payment.ts's new initiatedByStaffProfileId field is StaffProfile-space, not a *IdentityId shortcut", () => {
    const source = readFileSync(join(root, 'types', 'payment.ts'), 'utf8');
    expect(source).toMatch(/initiatedByStaffProfileId:\s*string \| null/);
    expect(source).not.toMatch(/initiatedByIdentityId/);
  });
});
