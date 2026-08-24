import { describe, expect, it } from 'vitest';
import { assertJournalEntryBalances } from './balancing';
import { buildBillPaymentPosting, buildVendorBillPosting, VendorBillPostingError } from './vendorBillPosting';

/** Sum debits − credits for a set of posting lines (must be 0 when balanced). */
function debitMinusCredit(lines: { direction: 'debit' | 'credit'; amount: number }[]): number {
  return lines.reduce((n, l) => n + (l.direction === 'debit' ? l.amount : -l.amount), 0);
}
function line(lines: { accountNumber: string; direction: string; amount: number }[], accountNumber: string) {
  return lines.find((l) => l.accountNumber === accountNumber);
}

describe('buildVendorBillPosting', () => {
  it('exact match (no variance): Dr 2100 / Cr 2000, no PPV line', () => {
    const p = buildVendorBillPosting([{ grniValueCents: 100000, billedAmountCents: 100000 }], []);
    expect(p.netVarianceCents).toBe(0);
    expect(line(p.lines, '5120')).toBeUndefined(); // no zero-amount PPV line
    expect(line(p.lines, '2100')).toEqual({ accountNumber: '2100', direction: 'debit', amount: 100000 });
    expect(line(p.lines, '2000')).toEqual({ accountNumber: '2000', direction: 'credit', amount: 100000 });
    expect(debitMinusCredit(p.lines)).toBe(0);
    expect(() => assertJournalEntryBalances(p.lines)).not.toThrow();
  });

  it('UNFAVORABLE variance (billed > received): Dr 5120, balanced', () => {
    // received-cost 100000, supplier bills 120000 → +20000 unfavorable
    const p = buildVendorBillPosting([{ grniValueCents: 100000, billedAmountCents: 120000 }], []);
    expect(p.netVarianceCents).toBe(20000);
    expect(line(p.lines, '2100')).toMatchObject({ direction: 'debit', amount: 100000 });
    expect(line(p.lines, '5120')).toMatchObject({ direction: 'debit', amount: 20000 }); // expense UP
    expect(line(p.lines, '2000')).toMatchObject({ direction: 'credit', amount: 120000 });
    expect(debitMinusCredit(p.lines)).toBe(0);
    expect(() => assertJournalEntryBalances(p.lines)).not.toThrow();
  });

  it('FAVORABLE variance (billed < received): Cr 5120, balanced', () => {
    // received-cost 100000, supplier bills 90000 → −10000 favorable
    const p = buildVendorBillPosting([{ grniValueCents: 100000, billedAmountCents: 90000 }], []);
    expect(p.netVarianceCents).toBe(-10000);
    expect(line(p.lines, '2100')).toMatchObject({ direction: 'debit', amount: 100000 });
    expect(line(p.lines, '5120')).toMatchObject({ direction: 'credit', amount: 10000 }); // expense DOWN
    expect(line(p.lines, '2000')).toMatchObject({ direction: 'credit', amount: 90000 });
    expect(debitMinusCredit(p.lines)).toBe(0);
    expect(() => assertJournalEntryBalances(p.lines)).not.toThrow();
  });

  it('mixed goods lines: aggregate variance nets favorable + unfavorable', () => {
    const p = buildVendorBillPosting(
      [
        { grniValueCents: 50000, billedAmountCents: 55000 }, // +5000
        { grniValueCents: 50000, billedAmountCents: 48000 }, // −2000
      ],
      [],
    );
    expect(p.totalGrniCents).toBe(100000);
    expect(p.netVarianceCents).toBe(3000); // net unfavorable
    expect(line(p.lines, '2100')).toMatchObject({ direction: 'debit', amount: 100000 });
    expect(line(p.lines, '5120')).toMatchObject({ direction: 'debit', amount: 3000 });
    expect(line(p.lines, '2000')).toMatchObject({ direction: 'credit', amount: 103000 });
    expect(debitMinusCredit(p.lines)).toBe(0);
  });

  it('goods + expense charge (freight): both post, AP = goods + expense', () => {
    const p = buildVendorBillPosting(
      [{ grniValueCents: 100000, billedAmountCents: 100000 }],
      [{ accountNumber: '5100', amountCents: 5000 }],
    );
    expect(p.totalExpenseCents).toBe(5000);
    expect(p.accountsPayableCreditCents).toBe(105000);
    expect(line(p.lines, '2100')).toMatchObject({ direction: 'debit', amount: 100000 });
    expect(line(p.lines, '5100')).toMatchObject({ direction: 'debit', amount: 5000 });
    expect(line(p.lines, '2000')).toMatchObject({ direction: 'credit', amount: 105000 });
    expect(debitMinusCredit(p.lines)).toBe(0);
    expect(() => assertJournalEntryBalances(p.lines)).not.toThrow();
  });

  it('expense-only (non-PO) bill: no 2100 line, Dr expense / Cr 2000', () => {
    const p = buildVendorBillPosting([], [{ accountNumber: '5010', amountCents: 7500 }]);
    expect(p.totalGrniCents).toBe(0);
    expect(line(p.lines, '2100')).toBeUndefined();
    expect(line(p.lines, '5010')).toMatchObject({ direction: 'debit', amount: 7500 });
    expect(line(p.lines, '2000')).toMatchObject({ direction: 'credit', amount: 7500 });
    expect(debitMinusCredit(p.lines)).toBe(0);
    expect(() => assertJournalEntryBalances(p.lines)).not.toThrow();
  });

  it('merges duplicate expense accounts into one line', () => {
    const p = buildVendorBillPosting([], [
      { accountNumber: '5010', amountCents: 3000 },
      { accountNumber: '5010', amountCents: 2000 },
    ]);
    const feeLines = p.lines.filter((l) => l.accountNumber === '5010');
    expect(feeLines).toHaveLength(1);
    expect(feeLines[0]).toMatchObject({ direction: 'debit', amount: 5000 });
  });

  it('rejects an empty bill (no positive total)', () => {
    expect(() => buildVendorBillPosting([], [])).toThrow(VendorBillPostingError);
    expect(() => buildVendorBillPosting([{ grniValueCents: 0, billedAmountCents: 0 }], [])).toThrow(VendorBillPostingError);
  });

  it('rejects fractional / negative cents', () => {
    expect(() => buildVendorBillPosting([{ grniValueCents: 100.5, billedAmountCents: 100 }], [])).toThrow(VendorBillPostingError);
    expect(() => buildVendorBillPosting([], [{ accountNumber: '5100', amountCents: -1 }])).toThrow(VendorBillPostingError);
  });
});

describe('buildBillPaymentPosting', () => {
  it('Dr 2000 AP / Cr cash, balanced', () => {
    const lines = buildBillPaymentPosting('1000', 42000);
    expect(line(lines, '2000')).toMatchObject({ direction: 'debit', amount: 42000 });
    expect(line(lines, '1000')).toMatchObject({ direction: 'credit', amount: 42000 });
    expect(debitMinusCredit(lines)).toBe(0);
    expect(() => assertJournalEntryBalances(lines)).not.toThrow();
  });

  it('rejects non-positive amount / missing cash account', () => {
    expect(() => buildBillPaymentPosting('1000', 0)).toThrow(VendorBillPostingError);
    expect(() => buildBillPaymentPosting('', 100)).toThrow(VendorBillPostingError);
  });
});
