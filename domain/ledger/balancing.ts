/**
 * Phase 31 (Financial Management & General Ledger). The one place "does
 * this journal entry balance" is decided — pure, side-effect-free, no
 * organizationId, no I/O, imported by both
 * services/generalLedgerService.ts (server, authoritative) and any future
 * client-side preview, mirroring domain/pricing/calculateOrder.ts's own
 * "pure calculation shared by server and browser" shape. Never imports
 * anything from lib/wixDataApi.ts, services/*, or hooks/*.
 *
 * Called at the top of every posting function, before any write is
 * attempted — an unbalanced entry is never even partially written. See
 * docs/adr/ADR-035-financial-management-and-general-ledger.md.
 */
export class UnbalancedJournalEntryError extends Error {}

export type JournalEntryLineInput = {
  direction: 'debit' | 'credit';
  amount: number;
};

/**
 * Throws `UnbalancedJournalEntryError` unless: at least 2 lines are given
 * (a single-line entry can never balance by definition); every amount is
 * a positive integer (a zero or negative line, or a fractional cent, is
 * never valid); and the sum of every 'debit' line's amount exactly equals
 * the sum of every 'credit' line's amount.
 */
export function assertJournalEntryBalances(lines: readonly JournalEntryLineInput[]): void {
  if (lines.length < 2) {
    throw new UnbalancedJournalEntryError('A journal entry must have at least 2 lines.');
  }

  for (const line of lines) {
    if (!Number.isInteger(line.amount) || line.amount <= 0) {
      throw new UnbalancedJournalEntryError('Every journal entry line amount must be a positive integer number of cents.');
    }
  }

  const debitTotal = lines.filter((l) => l.direction === 'debit').reduce((sum, l) => sum + l.amount, 0);
  const creditTotal = lines.filter((l) => l.direction === 'credit').reduce((sum, l) => sum + l.amount, 0);

  if (debitTotal !== creditTotal) {
    throw new UnbalancedJournalEntryError(
      `Journal entry does not balance: debits total ${debitTotal}, credits total ${creditTotal}.`,
    );
  }
}
