/**
 * SOLIS-wide ALL-CAPS data standard (2026-09). Accounting's normalization
 * policies — four small, explicit, per-entity functions rather than one
 * generic one, since "accounting text" spans several structurally distinct
 * entities (VendorBill, JournalEntry, CaseWriteOff, CaseCashAdvanceItem)
 * with very different technical/generated/manual fields sitting right next
 * to the ones this standard applies to.
 *
 * Every function here excludes: account numbers/keys, entryNumber(Key),
 * billNumber, every enum literal (VendorBillStatus, JournalEntryStatus,
 * JournalEntrySourceType, VendorBillLineKind, direction), monetary/numeric
 * values, and — critically — system-generated descriptions/snapshots
 * (CaseOrderLineItem.description, VendorBillLineItem.productDescriptionSnapshot,
 * JournalEntryLine rows written by createAndPostJournalEntry for a
 * non-manual sourceType). None of those are ever passed into these
 * functions by their call sites.
 */

/** VendorBill.notes + VendorBillLineItem.expenseDescription — both
    staff-entered at bill-creation time (services/accountsPayableService.ts's
    createVendorBill, the sole writer of both fields). Never touches
    billNumber, VendorBillLineKind, account numbers, or
    productDescriptionSnapshot (an immutable historical snapshot, not
    staff-typed at bill-entry time). */
export function normalizeVendorBillTextFields<T extends { notes?: unknown }>(input: T): T {
  if (typeof input.notes === 'string') {
    return { ...input, notes: input.notes.toUpperCase() };
  }
  return input;
}

export function normalizeExpenseDescription(expenseDescription: string | null): string | null {
  return typeof expenseDescription === 'string' ? expenseDescription.toUpperCase() : expenseDescription;
}

/**
 * JournalEntry.memo / JournalEntryLine.description — ONLY for a manual
 * entry. `services/generalLedgerService.ts`'s `createDraftJournalEntry` is
 * the sole entry point for a `sourceType: 'manual'` entry (every
 * system-generated sourceType goes through `createAndPostJournalEntry`
 * instead, which never calls this function) — so calling this only from
 * the draft/manual path is what keeps a system-generated memo/description
 * (which may legitimately embed a case number, an entry number reference,
 * or other exact-case-sensitive text composed by the code itself) from
 * ever being rewritten.
 */
export function normalizeManualJournalEntryMemo(memo: string): string {
  return memo.toUpperCase();
}

export function normalizeManualJournalEntryLineDescription(description: string | null | undefined): string | null | undefined {
  return typeof description === 'string' ? description.toUpperCase() : description;
}

/** CaseWriteOff.reason — staff-entered at write-off time. */
export function normalizeWriteOffTextFields<T extends { reason?: unknown }>(input: T): T {
  if (typeof input.reason === 'string') {
    return { ...input, reason: input.reason.toUpperCase() };
  }
  return input;
}

/** CaseCashAdvanceItem.description — staff-entered. */
export function normalizeCashAdvanceTextFields<T extends { description?: unknown }>(input: T): T {
  if (typeof input.description === 'string') {
    return { ...input, description: input.description.toUpperCase() };
  }
  return input;
}
