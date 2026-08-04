/**
 * Phase 27 (Scheduling & Resource Management). A `RecurrenceDefinition` is
 * genuinely immutable once created — no update path exists anywhere in
 * this codebase for this collection (enforced structurally, mirroring
 * `types/signatureRecord.ts`'s own "insert-only, never updated" test). A
 * changed recurrence pattern going forward always creates a NEW
 * `RecurrenceDefinition`; the original row and every `Appointment`
 * occurrence still pointing at it are untouched — the same
 * corrections-create-new-never-mutate discipline already established for
 * `SignatureRequest`/`CaseDocument`. Each occurrence is still a real,
 * independently editable `Appointment` row (see types/appointment.ts's
 * `recurrenceDefinitionId`/`isRecurrenceException`); this record only
 * carries the pattern itself, used to materialize occurrences at creation
 * time — never expanded at read time.
 * See docs/adr/ADR-031-scheduling-and-resource-management.md.
 */
export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

export type RecurrenceDefinition = {
  id: string;
  organizationId: string;
  frequency: RecurrenceFrequency;
  /** Every N `frequency` units — e.g. `frequency: 'weekly', interval: 2` is "every other week." */
  interval: number;
  /** 0 (Sunday) - 6 (Saturday). Only meaningful for `frequency: 'weekly'`. */
  byWeekday: number[] | null;
  /** A fixed occurrence count. Mutually exclusive with `until` — exactly
      one of `count`/`until` is set. */
  count: number | null;
  /** A fixed end date. Mutually exclusive with `count`. */
  until: string | null;
  createdBy: string;
  createdAt: string;
};

export type NewRecurrenceDefinitionInput = {
  frequency: RecurrenceFrequency;
  interval: number;
  byWeekday?: number[];
  count?: number;
  until?: string;
};
