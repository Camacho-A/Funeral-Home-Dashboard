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
import type { CaseWorkflowSnapshot } from './workflowTemplate';

/** Manors launch-prep. The NOK's relationship to the deceased — a small,
    closed dropdown (never free text) distinct from
    `domain/portal/portalRelationshipRegistry.ts`'s `PortalRelationshipType`,
    which answers a different question (what Family Portal *capabilities*
    a portal user has) — this one is purely descriptive case information,
    never tied to portal access. `'other'` is the only value that pairs
    with a free-text detail (`nextOfKinRelationshipOther`). */
export type NextOfKinRelationship =
  | 'spouse'
  | 'domestic_partner'
  | 'son'
  | 'daughter'
  | 'parent'
  | 'brother'
  | 'sister'
  | 'grandchild'
  | 'grandparent'
  | 'niece'
  | 'nephew'
  | 'other_relative'
  | 'friend'
  | 'legal_representative'
  | 'other';

export type PaymentStatus = 'awaiting_payment' | 'paid_in_full';
export type VaPublishChoice = 'publish' | 'private';
/** Manors VA notification responsibility (2026-09). A SEPARATE fact from
    `isVeteran` — "did the decedent serve" vs. "who is handling notifying
    the VA" are two independent questions, and conflating them was the
    exact bug this type exists to prevent. `null` means undecided — never
    inferred/defaulted to `'manors'` (see `domain/cases/veteran.ts`'s
    `isVaComplete`, which fails safely: undecided is treated the same as
    "not yet complete," identical to `'manors'` with its steps unfinished,
    never silently treated as `'family'`-equivalent). `'family'` means the
    internal VA Notification checklist (`VA_STEPS`) does not apply — Manors
    staff are never required to complete it, and the case is never flagged
    as needing attention for it. */
export type VaNotificationResponsibility = 'manors' | 'family';
/** Manors launch-prep. Whether cremated remains are still with the
    provider or have been released to the family — the answer staff need
    at a glance, distinct from the free-text case log. Mirrors
    `PaymentStatus`'s exact "small closed enum, not a boolean" shape. */
export type PickupStatus = 'awaiting_pickup' | 'released';

/** Conditional shipping/tracking (2026-09). How cremated remains will be
    (or were) returned to the family — deliberately NOT decided at intake
    by default: `'undecided'` is the honest starting state for every new
    case, distinct from `'pickup'`, since a family not yet having chosen is
    not the same fact as a family having chosen pickup. See
    `domain/cases/returnMethod.ts` for the completion/heading logic this
    field drives. */
export type ReturnMethod = 'undecided' | 'pickup' | 'shipping';

/** Mirrors `PickupStatus`'s own "small closed enum" shape — `'shipped'` is
    reachable before a carrier/tracking number necessarily exist yet
    (staff may record "shipped" the same day they enter tracking, or a beat
    later); `'delivered'` is the one state that satisfies the terminal
    return-of-remains requirement for a Shipping case — see
    `domain/cases/returnMethod.ts#isTerminalReturnRequirementComplete`. */
export type ShippingDeliveryStatus = 'shipped' | 'delivered';

export type Case = {
  id: string;
  organizationId: string;
  /**
   * Phase 16B (Case Number Generation). The human-facing case identifier —
   * distinct from `id` (an internal, never-displayed key — a UUID in Wix
   * mode, a small mock-only number in mock mode). Format: `B{YYYY}-{###}`
   * (e.g. `B2026-001`) — see domain/cases/caseNumber.ts, the single source
   * of truth for that format, and docs/adr/ADR-018-case-number-generation.md
   * for why. Always server-generated at creation time (casesService.create
   * / app/api/cases/route.ts's POST handler); never present in
   * NewCaseInput, never editable via CaseUpdate (see below) — a case's
   * number is permanent for its entire lifetime, including after it's
   * archived, exactly like its own `id`.
   */
  caseNumber: string;
  decedentName: string;
  dateOfBirth: string; // display-formatted (MM/DD/YYYY), matching the prototype — no date math is ever performed on it directly
  dateOfDeath: string;
  timeOfDeath: string;
  placeOfDeath: string;
  weight: string; // e.g. "178 lb" — parsed at derivation time for the >200lb flag, see domain/cases/viewModel.ts
  rawStage: number; // 0-8; see domain/cases/stages.ts for the raw->display mapping
  /** references StaffProfile.id; null = unassigned ("—" in the prototype).
      The *current* case handler — freely reassignable any time via
      CaseInformationCard's owner select (see useCaseMutations.reassignOwner).
      Distinct from intakeOwnerId below, which never changes after creation
      even though the two happen to start out equal. */
  assignedStaffId: string | null;
  nextOfKinName: string;
  nextOfKinPhone: string;
  /** Manors launch-prep. Optional — many cases won't have one at intake.
      A proper structured field on the existing NOK information, never
      Notes/case log. Trimmed; validated as a reasonably-formatted email
      when non-null (see utils/inputMask.ts#isValidEmail, the same
      validator every other email field in this codebase already uses).
      Capture-only: entering a value here never sends anything, creates a
      Family Portal account, or sends an invitation — see
      services/portal/* for the separate, deliberate invitation flow that
      does. */
  nextOfKinEmail: string | null;
  /** Manors launch-prep. Optional — unset until staff know it, editable
      any time afterward. `null` when not yet set; `'other'` pairs with
      `nextOfKinRelationshipOther` for a short free-text description. */
  nextOfKinRelationship: NextOfKinRelationship | null;
  /** Only meaningful when `nextOfKinRelationship === 'other'` — a short
      free-text description, same "detail field only shown for one
      specific selection" pattern as `pickupReleasedTo`/etc. below. */
  nextOfKinRelationshipOther: string | null;
  /** Manors launch-prep. Operational tag/ID affixed to the remains for
      chain-of-custody tracking — distinct from `caseNumber` (Solis's own
      permanent record identifier). Null until staff assign one; editable
      any time, unlike caseNumber. Not required at creation — a case may
      exist before a physical tag is assigned. */
  tagNumber: string | null;
  paymentStatus: PaymentStatus;
  isVeteran: boolean;
  vaStepsState: Record<number, boolean>;
  vaPublishChoice: VaPublishChoice | null;
  /** Who is handling VA notification for this veteran — see
      `VaNotificationResponsibility`'s own comment. Only meaningful when
      `isVeteran` is true; `null` (undecided) for every non-veteran case
      and for a veteran case where the decision hasn't been made yet. */
  vaNotificationResponsibility: VaNotificationResponsibility | null;
  checklistState: Record<number, boolean>;
  fieldValues: Record<number, string>;
  /** Manors launch-prep. Structured pickup/release tracking — the answer
      "are the remains still here or have they gone home?" without relying
      on free-form Notes/case-log alone. Defaults to 'awaiting_pickup' for
      every case; the other three fields stay null until release is
      actually recorded. All staff-entered display strings, matching every
      other date/name field on Case (dateOfDeath, nextOfKinName, etc.) —
      no new formatting convention introduced. */
  pickupStatus: PickupStatus;
  /** Who the remains were released to — a name, not a StaffProfile
      reference (this is the family/receiving party, not a staff member). */
  pickupReleasedTo: string | null;
  pickupReleasedAt: string | null;
  pickupNote: string | null;
  /** Conditional shipping/tracking (2026-09). Defaults to `'undecided'` for
      every new case — never `'pickup'`, see `ReturnMethod`'s own comment.
      Freely editable at any point in the case's life, including after
      Completed (see `domain/cases/returnMethod.ts`); switching between
      values never clears the other method's fields below, only changes
      which of them the UI renders. */
  returnMethod: ReturnMethod;
  /** The five fields below are only ever meaningful when
      `returnMethod === 'shipping'`, but are never cleared when it isn't —
      preserving previously entered shipping data if staff switch back to
      Pickup (or Undecided) and later switch to Shipping again, mirroring
      `pickupReleasedTo`/etc.'s own existing "toggle hides, never destroys"
      behavior. */
  shippingCarrier: string | null;
  shippingTrackingNumber: string | null;
  shippingDateShipped: string | null;
  shippingDeliveryStatus: ShippingDeliveryStatus | null;
  shippingDeliveredAt: string | null;
  daysWaitingInStage: number; // mock-static for this phase; a real backend would derive this from a stage-entry timestamp
  isStalled: boolean;
  stalledReason: string | null;
  createdBy: string | null; // references StaffProfile.id, per docs/CMS_SCHEMA.md's "staff member who opened the case" — same FK convention as assignedStaffId, not a free-text name
  /** The staff member who took the intake call, derived automatically from
      the trusted session at creation time (see casesService.create) — never
      accepted from the New Case form and never editable afterward, unlike
      assignedStaffId. Enforced at three layers: NewCaseInput has no such
      field (so the form literally cannot supply one), CaseUpdate omits it
      below (a compile-time guarantee), and
      domain/cases/intakeOwnership.ts's assertIntakeOwnerUnchanged is a
      runtime backstop against anything that reaches the service anyway
      (an `as any` cast, or a future non-TS caller). Null only for
      historical/seed records that predate this field — a real gap, not a
      fabricated backfill. */
  intakeOwnerId: string | null;
  createdAt: string;
  isDeleted: boolean; // soft-delete only, per docs/DECISIONS.md and docs/adr — never hard-deleted

  /**
   * Phase 11 (Workflow Template Architecture). Which workflow template —
   * and, critically, which *version* of it — this case was created from.
   * See types/workflowTemplate.ts and docs/TEMPLATE_VERSIONING.md.
   */
  workflowTemplateId: string;
  workflowTemplateVersion: number;
  /** Which of the template's supported case types this specific case is —
      a template can support more than one (e.g. cremation + burial), so
      the case itself has to record which one applies to it. */
  caseType: string;
  /** Immutable copy of the resolved stages/checklist/intake structure at
      creation time — see types/workflowTemplate.ts's CaseWorkflowSnapshot
      comment. Every stage/checklist-resolving domain function
      (domain/workflow/*, domain/cases/viewModel.ts) reads this, never the
      live WorkflowTemplate fixture, so editing a template later can never
      retroactively change an existing case. Null only for historical/seed
      records migrated before this field existed — see
      docs/TEMPLATE_VERSIONING.md's migration notes; every backfilled
      fixture case is given the Managed Cremations v1 snapshot, so in
      practice this is non-null for all current mock data. */
  workflowSnapshot: CaseWorkflowSnapshot | null;
};

/**
 * Deliberately excludes `createdBy`, `intakeOwnerId`, `assignedStaffId`,
 * and the Phase 11 workflow fields (`workflowTemplateId`,
 * `workflowTemplateVersion`, `caseType`, `workflowSnapshot`) from the
 * required fields a caller must supply — all of these are derived by
 * casesService.create from trusted parameters (session, the resolved
 * WorkflowTemplate/version — see its own signature), never from
 * client-editable form state. `assignedStaffId` stays available as an
 * *optional* override for a future caller with an explicit assignee
 * picker; the New Case modal doesn't pass one, so it falls back to the
 * session default, matching design/support.js's `owner: createdBy`
 * behavior.
 */
export type NewCaseInput = Pick<Case, 'decedentName' | 'nextOfKinName' | 'nextOfKinPhone'> &
  Partial<
    Pick<
      Case,
      | 'dateOfBirth' | 'dateOfDeath' | 'timeOfDeath' | 'placeOfDeath' | 'weight' | 'assignedStaffId'
      | 'nextOfKinEmail' | 'nextOfKinRelationship' | 'nextOfKinRelationshipOther'
      /** Optional at intake — a family may not have decided yet. Omitted
          defaults to `'undecided'`, never `'pickup'` (see `ReturnMethod`'s
          own comment). No shipping-detail field is ever accepted here —
          Carrier/Tracking Number/Date Shipped cannot be set at case
          creation, by construction (not present in this type at all). */
      | 'returnMethod'
    >
  > & {
    fieldValues?: Record<number, string>;
  };

/**
 * `createdBy`, `intakeOwnerId`, `workflowTemplateId`, and
 * `workflowTemplateVersion` are excluded here, not just left off
 * NewCaseInput — this is the compile-time half of their immutability
 * guarantee; domain/cases/intakeOwnership.ts's assertIntakeOwnerUnchanged
 * is the runtime half for intakeOwnerId (the only one of these with an
 * explicit "Rules" requirement to enforce at runtime too).
 * `workflowSnapshot` is likewise excluded — it's a point-in-time copy, not
 * something an update patch should ever touch.
 */
export type CaseUpdate = Partial<
  Omit<
    Case,
    | 'id'
    | 'organizationId'
    | 'createdAt'
    | 'createdBy'
    | 'intakeOwnerId'
    | 'workflowTemplateId'
    | 'workflowTemplateVersion'
    | 'workflowSnapshot'
    | 'caseNumber'
  >
>;
