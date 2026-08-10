import { describe, expect, it } from 'vitest';
import { assertJournalEntryBalances, UnbalancedJournalEntryError } from './balancing';

describe('assertJournalEntryBalances', () => {
  it('allows a simple balanced two-line entry', () => {
    expect(() =>
      assertJournalEntryBalances([
        { direction: 'debit', amount: 1000 },
        { direction: 'credit', amount: 1000 },
      ]),
    ).not.toThrow();
  });

  it('allows a balanced multi-line entry (multiple debits, one credit)', () => {
    expect(() =>
      assertJournalEntryBalances([
        { direction: 'debit', amount: 400 },
        { direction: 'debit', amount: 600 },
        { direction: 'credit', amount: 1000 },
      ]),
    ).not.toThrow();
  });

  it('rejects an unbalanced entry', () => {
    expect(() =>
      assertJournalEntryBalances([
        { direction: 'debit', amount: 1000 },
        { direction: 'credit', amount: 999 },
      ]),
    ).toThrow(UnbalancedJournalEntryError);
  });

  it('rejects a single-line entry', () => {
    expect(() => assertJournalEntryBalances([{ direction: 'debit', amount: 1000 }])).toThrow(
      /at least 2 lines/,
    );
  });

  it('rejects an empty entry', () => {
    expect(() => assertJournalEntryBalances([])).toThrow(UnbalancedJournalEntryError);
  });

  it('rejects a zero-amount line', () => {
    expect(() =>
      assertJournalEntryBalances([
        { direction: 'debit', amount: 0 },
        { direction: 'credit', amount: 0 },
      ]),
    ).toThrow(/positive integer/);
  });

  it('rejects a negative-amount line', () => {
    expect(() =>
      assertJournalEntryBalances([
        { direction: 'debit', amount: -100 },
        { direction: 'credit', amount: 100 },
      ]),
    ).toThrow(/positive integer/);
  });

  it('rejects a non-integer (fractional cent) amount', () => {
    expect(() =>
      assertJournalEntryBalances([
        { direction: 'debit', amount: 100.5 },
        { direction: 'credit', amount: 100.5 },
      ]),
    ).toThrow(/positive integer/);
  });

  it('never even partially validates — an unbalanced entry throws before any caller could act on it', () => {
    let reached = false;
    try {
      assertJournalEntryBalances([
        { direction: 'debit', amount: 1000 },
        { direction: 'credit', amount: 500 },
      ]);
      reached = true;
    } catch {
      // expected
    }
    expect(reached).toBe(false);
  });
});
