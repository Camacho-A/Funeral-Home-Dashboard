/**
 * Raw, persisted case record. Diverges from docs/CMS_SCHEMA.md's `Cases`
 * collection field list in a few places, each because the actual working
 * prototype (design/Beacon.dc.html) doesn't back the richer shape
 * CMS_SCHEMA.md speculated — and per this project's build-only-what's-used
 * discipline (see docs/UI_COMPONENTS.md's build-now/deferred table), the
 * simpler shape wins until a real screen needs the richer one:
 *
 * - `decedentName` is a single field, not `decedentFirstName`/`decedentLastName`
 *   — the prototype only ever stores/displays a full name string
 *   ("Robert Ellison"), never split, and splitting it would require
 *   guessing at multi-word name boundaries with no real payoff.
 * - `rawStage` is the numeric 0-8 index the domain logic actually operates
 *   on (see domain/cases/stages.ts), not a `status` enum string —
 *   matching how design/support.js's Component script represents it.
 * - No `dispositionType` field — it never appears anywhere in
 *   design/support.js's seed data or UI, unlike what CMS_SCHEMA.md proposed.
 * - No standalone `notes` field — the prototype's only free-text record on
 *   a case is the structured case log (a distinct, deferred entity; see
 *   types/caseLogEntry.ts), not a single notes blob.
 * - `checklistState`/`fieldValues`/`isVeteran`/`vaStepsState`/`vaPublishChoice`
 *   are what CMS_SCHEMA.md already called for — these are real persisted
 *   business data (once a checklist item is checked, that's a fact, not
 *   transient UI state), not something layered on top separately.
 */
export type PaymentStatus = 'awaiting_payment' | 'paid_in_full';
export type VaPublishChoice = 'publish' | 'private';

export type Case = {
  id: string;
  organizationId: string;
  decedentName: string;
  dateOfBirth: string; // display-formatted (MM/DD/YYYY), matching the prototype — no date math is ever performed on it directly
  dateOfDeath: string;
  timeOfDeath: string;
  placeOfDeath: string;
  weight: string; // e.g. "178 lb" — parsed at derivation time for the >200lb flag, see domain/cases/viewModel.ts
  rawStage: number; // 0-8; see domain/cases/stages.ts for the raw->display mapping
  assignedStaffId: string | null; // references StaffProfile.id; null = unassigned ("—" in the prototype)
  nextOfKinName: string;
  nextOfKinPhone: string;
  paymentStatus: PaymentStatus;
  isVeteran: boolean;
  vaStepsState: Record<number, boolean>;
  vaPublishChoice: VaPublishChoice | null;
  checklistState: Record<number, boolean>;
  fieldValues: Record<number, string>;
  daysWaitingInStage: number; // mock-static for this phase; a real backend would derive this from a stage-entry timestamp
  isStalled: boolean;
  stalledReason: string | null;
  createdBy: string | null;
  createdAt: string;
  isDeleted: boolean; // soft-delete only, per docs/DECISIONS.md and docs/adr — never hard-deleted
};

export type NewCaseInput = Pick<
  Case,
  'decedentName' | 'nextOfKinName' | 'nextOfKinPhone' | 'createdBy'
> &
  Partial<Pick<Case, 'dateOfBirth' | 'dateOfDeath' | 'timeOfDeath' | 'placeOfDeath' | 'weight'>> & {
    fieldValues?: Record<number, string>;
  };

export type CaseUpdate = Partial<Omit<Case, 'id' | 'organizationId' | 'createdAt' | 'createdBy'>>;
