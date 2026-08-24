import { STARTER_ACCOUNT_NUMBERS } from './starterChartOfAccounts';

/**
 * Phase 36 (Procurement & Accounts Payable). The one place a vendor bill's
 * journal-entry lines are computed — pure, side-effect-free, no
 * organizationId, no account-id resolution, no I/O. Mirrors
 * domain/ledger/balancing.ts's "shared, testable calculation" shape and is
 * imported by services/accountsPayableService.ts (which resolves account
 * NUMBERS → account ids and posts through the ledger) and by unit tests that
 * prove balance and variance sign/direction independently of any Wix write.
 *
 * The accounting model (ADR-040):
 *   Dr 2100 Inventory Clearing   — the receipt-valued (GRNI) amount cleared
 *   Dr/Cr 5120 Purchase Price Variance — the net goods price difference
 *   Dr <expense/asset account>   — each non-goods charge (freight, service…)
 *   Cr 2000 Accounts Payable     — the full supplier liability (what's billed)
 *
 * Goods lines clear a receipt's GRNI accrual: `grniValueCents` is what was
 * credited to 2100 at receiving for the billed quantity; `billedAmountCents`
 * is what the supplier actually charges for it. Their aggregate difference is
 * the Purchase Price Variance:
 *   variance = Σ billedGoods − Σ grni
 *   variance > 0 (billed MORE than received-cost → UNFAVORABLE) → Dr 5120
 *   variance < 0 (billed LESS → FAVORABLE)                      → Cr 5120
 *   variance = 0                                                → no PPV line
 * (5120 is omitted when zero because domain/ledger/balancing.ts rejects any
 * non-positive line amount — direction, never a signed amount, carries sign.)
 *
 * Expense lines are non-goods charges; each debits an explicit
 * expense/asset account. They NEVER touch inventory (1300), GRNI (2100), or
 * AP (2000) itself — that guard lives in the service, which knows account
 * types; this function only assembles balanced lines from validated input.
 */
export class VendorBillPostingError extends Error {}

export type VendorBillGoodsPostingInput = {
  /** Receipt-valued amount cleared from 2100 for the billed quantity (cents). */
  grniValueCents: number;
  /** Amount the supplier bills for that quantity → credited to AP (cents). */
  billedAmountCents: number;
};

export type VendorBillExpensePostingInput = {
  /** The expense/asset account NUMBER to debit (validated by the service). */
  accountNumber: string;
  amountCents: number;
};

export type VendorBillPostingLine = {
  accountNumber: string;
  direction: 'debit' | 'credit';
  amount: number;
};

export type VendorBillPosting = {
  lines: VendorBillPostingLine[];
  totalGrniCents: number;
  /** Net goods variance: positive = unfavorable (Dr 5120), negative =
      favorable (Cr 5120), zero = no PPV line. */
  netVarianceCents: number;
  totalExpenseCents: number;
  /** The Accounts Payable credit = total goods billed + total expense. */
  accountsPayableCreditCents: number;
};

function assertNonNegativeIntegerCents(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new VendorBillPostingError(`${label} must be a non-negative integer number of cents.`);
  }
}

/**
 * Builds the balanced journal lines for a vendor bill. Throws
 * `VendorBillPostingError` if the inputs are malformed or the bill has no
 * positive total (a bill with nothing to post is never valid). The returned
 * `lines` are guaranteed to satisfy `assertJournalEntryBalances`.
 */
export function buildVendorBillPosting(
  goods: readonly VendorBillGoodsPostingInput[],
  expenses: readonly VendorBillExpensePostingInput[],
): VendorBillPosting {
  let totalGrniCents = 0;
  let totalBilledGoodsCents = 0;
  for (const line of goods) {
    assertNonNegativeIntegerCents(line.grniValueCents, 'grniValueCents');
    assertNonNegativeIntegerCents(line.billedAmountCents, 'billedAmountCents');
    totalGrniCents += line.grniValueCents;
    totalBilledGoodsCents += line.billedAmountCents;
  }

  // Merge expense lines by account number so one entry never carries two
  // lines for the same account (cleaner audit), summing their amounts.
  const expenseByAccount = new Map<string, number>();
  let totalExpenseCents = 0;
  for (const line of expenses) {
    assertNonNegativeIntegerCents(line.amountCents, 'expense amountCents');
    if (line.amountCents === 0) continue; // a zero charge posts nothing
    if (!line.accountNumber || line.accountNumber.trim().length === 0) {
      throw new VendorBillPostingError('Every expense line must name an account number.');
    }
    expenseByAccount.set(line.accountNumber, (expenseByAccount.get(line.accountNumber) ?? 0) + line.amountCents);
    totalExpenseCents += line.amountCents;
  }

  const netVarianceCents = totalBilledGoodsCents - totalGrniCents;
  const accountsPayableCreditCents = totalBilledGoodsCents + totalExpenseCents;

  if (accountsPayableCreditCents <= 0) {
    throw new VendorBillPostingError('A vendor bill must have a positive total (goods and/or expense charges).');
  }

  const lines: VendorBillPostingLine[] = [];

  // Dr 2100 Inventory Clearing — clears the goods GRNI accrual (omit if the
  // bill is expense-only, i.e. no goods were received/billed).
  if (totalGrniCents > 0) {
    lines.push({ accountNumber: STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING, direction: 'debit', amount: totalGrniCents });
  }

  // Dr/Cr 5120 Purchase Price Variance — only when non-zero.
  if (netVarianceCents > 0) {
    lines.push({ accountNumber: STARTER_ACCOUNT_NUMBERS.PURCHASE_PRICE_VARIANCE, direction: 'debit', amount: netVarianceCents });
  } else if (netVarianceCents < 0) {
    lines.push({ accountNumber: STARTER_ACCOUNT_NUMBERS.PURCHASE_PRICE_VARIANCE, direction: 'credit', amount: -netVarianceCents });
  }

  // Dr each expense/asset account (stable order by account number).
  for (const accountNumber of [...expenseByAccount.keys()].sort()) {
    lines.push({ accountNumber, direction: 'debit', amount: expenseByAccount.get(accountNumber)! });
  }

  // Cr 2000 Accounts Payable — the full supplier liability.
  lines.push({ accountNumber: STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE, direction: 'credit', amount: accountsPayableCreditCents });

  return { lines, totalGrniCents, netVarianceCents, totalExpenseCents, accountsPayableCreditCents };
}

/**
 * The balanced lines for a vendor PAYMENT: Dr 2000 Accounts Payable / Cr the
 * given cash/bank account. A record of an externally-executed payment.
 */
export function buildBillPaymentPosting(cashAccountNumber: string, amountCents: number): VendorBillPostingLine[] {
  assertNonNegativeIntegerCents(amountCents, 'payment amountCents');
  if (amountCents <= 0) throw new VendorBillPostingError('A vendor payment must be a positive amount.');
  if (!cashAccountNumber || cashAccountNumber.trim().length === 0) {
    throw new VendorBillPostingError('A vendor payment must name a cash/bank account.');
  }
  return [
    { accountNumber: STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE, direction: 'debit', amount: amountCents },
    { accountNumber: cashAccountNumber, direction: 'credit', amount: amountCents },
  ];
}
