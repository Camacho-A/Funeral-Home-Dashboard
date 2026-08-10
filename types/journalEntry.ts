/**
 * Phase 31 (Financial Management & General Ledger). The double-entry
 * general ledger — every financial event in Beacon is journaled as one
 * `JournalEntry` header plus ≥2 balanced `JournalEntryLine` rows. See
 * docs/adr/ADR-035-financial-management-and-general-ledger.md.
 *
 * **Posting lifecycle**: every system-generated entry (`payment`,
 * `refund`, `write_off`, `adjustment`, `deposit`, `transfer`, `reversal`)
 * is created already `posted` — it's derived from an already-decided
 * real-world event, so an intermediate draft state adds no review value.
 * Only `sourceType: 'manual'` entries support `draft` → `posted`, so a
 * preparer can compose a multi-line entry and review it before posting.
 * The moment `status` becomes `'posted'`, the entry and every one of its
 * lines are permanently immutable — `services/generalLedgerService.ts`'s
 * `updateDraftJournalEntryLines` is the *only* mutation ever allowed, and
 * only while `status === 'draft'`.
 *
 * **Reversing entries never mutate the original.** `reversesEntryId` lives
 * only on the *new* reversing entry (a forward-only reference) —
 * "has entry X been reversed" is always a query
 * (`journalEntries.filter(e => e.reversesEntryId === X.id)`), never a field
 * added back onto the original after the fact. This is what keeps every
 * posted `JournalEntry` write-once forever, with zero exceptions.
 *
 * **Balancing is enforced before any write is attempted** — see
 * `domain/ledger/balancing.ts#assertJournalEntryBalances`, called at the
 * top of every posting function. An unbalanced entry is never even
 * partially written.
 *
 * **`entryNumberKey` is the atomicity primitive**, not a lock service:
 * `entryNumber` itself (e.g. "JE-000123") is a clean, user-facing display
 * value — composing `{organizationId}:{entryNumber}` directly into it,
 * the way `PaymentRecord.idempotencyKey` composes its own value, would
 * show a garbled string in every report and UI that displays it. Instead,
 * `entryNumberKey` is a separate, internal-only field holding that
 * composed value, carrying the real Wix unique index. Posting finds the
 * org's highest existing `entryNumber`, increments, and attempts an
 * insert; a genuine Wix Data conflict on `entryNumberKey` (not a
 * check-then-insert race) is what actually prevents two concurrent posts
 * from claiming the same number — retried up to 5 times on conflict. See
 * `services/generalLedgerService.ts`.
 */
export type JournalEntrySourceType =
  | 'payment'
  | 'refund'
  | 'write_off'
  | 'adjustment'
  | 'deposit'
  | 'transfer'
  | 'manual'
  | 'opening_balance'
  | 'reversal';

export type JournalEntryStatus = 'draft' | 'posted' | 'void';

export type JournalEntry = {
  id: string;
  organizationId: string;
  /** Clean, user-facing display value, e.g. "JE-000123" — see this file's
      own header comment on why uniqueness is NOT enforced on this field
      directly. */
  entryNumber: string;
  /** Internal only, never displayed — `{organizationId}:{entryNumber}`,
      the field the real Wix unique index actually sits on. */
  entryNumberKey: string;
  /** The accounting date — may be backdated for a manual entry; distinct
      from `createdAt`. */
  entryDate: string;
  status: JournalEntryStatus;
  sourceType: JournalEntrySourceType;
  /** The originating record's id — e.g. a `PaymentRecord.id` or
      `BankDeposit.id` — null for a `manual` entry with no single source. */
  sourceReferenceId: string | null;
  /** Denormalized — most entries tie to exactly one case. */
  caseId: string | null;
  memo: string;
  /** Set ONLY on a reversing entry — see this file's own header comment
      on why this is a forward-only reference. */
  reversesEntryId: string | null;
  postedAt: string | null;
  /** StaffProfile-space, never Identity-space directly — per
      docs/adr/ADR-034-identity-model-hardening-and-staff-assignment-architecture.md's
      hard layering invariant, resolved via
      `services/staffProfileService.ts#resolveStaffProfileForCaller`. */
  postedByStaffProfileId: string | null;
  createdAt: string;
  /** Only ever changes on a draft→posted or draft→void transition; never
      mutated once `status === 'posted'`. */
  updatedAt: string;
};

export type JournalEntryLine = {
  id: string;
  organizationId: string;
  journalEntryId: string;
  lineNumber: number;
  accountId: string;
  /** Explicit, never a signed amount — eliminates an entire class of
      sign-convention bugs. */
  direction: 'debit' | 'credit';
  /** Always a positive integer cents value. */
  amount: number;
  /** Denormalized, for case-scoped GL views. */
  caseId: string | null;
  description: string | null;
  /** Fully immutable, write-once — mirrors `CaseOrderLineItem`. */
  createdAt: string;
};
