import { afterEach, describe, expect, it } from 'vitest';
import { reconcileCaseWorkflow, computeFirstIncompleteRawStage } from './workflowReconciliationService';
import { resolveChecklist } from '../domain/workflow/resolveChecklist';
import { writeChecklistValue } from '../domain/workflow/checklistItemKey';
import { caseFixtures, DEFAULT_ORGANIZATION_ID } from './__mocks__/fixtures';
import { caseFormLinkFixtures, ARRANGEMENT_FORMS_FORM_CONFIG_ID, VITAL_STATISTICS_FORM_CONFIG_ID } from './__mocks__/externalFormFixtures';
import { standardCremationWorkflowTemplateFixture } from './__mocks__/workflowTemplates';
import { buildCaseWorkflowSnapshot } from '../domain/workflow/snapshot';
import { buildCaseViewModel } from '../domain/cases/viewModel';
import type { Case } from '../types/case';
import type { CaseFormLink } from '../types/caseFormLink';

/**
 * Manors workflow reconciliation (2026-09). Covers the checkpoint's
 * "TESTS — WORKFLOW" list items 1, 2 (same mechanism as normal receipt —
 * exercised via the route-level historical-import test separately), 3
 * (implicitly, via paymentWorkflow.test.ts), 5, 6, 7, 8, 9.
 */

// Structured Certifier data (2026-09, ADR-041): explicitly pinned to
// versions[0] (v1), never `latestTemplateVersion` — this suite tests
// generic stage/checklist reconciliation against the dcContact-era 11-item
// First Call & Payment shape specifically (see `satisfyFirstCallStage`
// below, which populates fieldValues[6] for the legacy contact field).
// Resolving "latest" would silently switch these cases onto v5's
// Certifier Information item (index 6, requiredCaseFields-driven,
// completed via structured Case fields, not fieldValues), capping every
// stage-advancement test at rawStage 0 — the same class of bug already
// caught and fixed in services/__mocks__/fixtures.ts.
const SNAPSHOT_VERSION = standardCremationWorkflowTemplateFixture.versions[0];

/** A case sitting at rawStage 0 with a real 8-stage Managed Cremations
    snapshot and otherwise-default (empty) checklistState/fieldValues —
    the "nothing done yet" baseline every test starts from and mutates. */
function buildTestCase(overrides: Partial<Case> = {}): Case {
  const id = overrides.id ?? `wf-recon-test-${Math.random().toString(36).slice(2)}`;
  const base: Case = {
    id,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-900',
    decedentName: 'Test Decedent',
    dateOfBirth: '01/01/1950',
    dateOfDeath: '01/01/2026',
    timeOfDeath: '10:00',
    placeOfDeath: 'Test Hospital',
    weight: '150 lb',
    rawStage: 0,
    assignedStaffId: null,
    nextOfKinName: 'Test NOK',
    nextOfKinPhone: '555-0100',
    nextOfKinEmail: null,
    nextOfKinRelationship: null,
    nextOfKinRelationshipOther: null,
    certifierName: null,
    certifierPhone: null,
    certifierLicenseNumber: null,
    certifierFax: null,
    tagNumber: null,
    paymentStatus: 'awaiting_payment',
    pickupStatus: 'awaiting_pickup',
    pickupReleasedTo: null,
    pickupReleasedAt: null,
    pickupNote: null,
    returnMethod: 'undecided',
    shippingCarrier: null,
    shippingTrackingNumber: null,
    shippingDateShipped: null,
    shippingDeliveryStatus: null,
    shippingDeliveredAt: null,
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    vaNotificationResponsibility: null,
    checklistState: {},
    fieldValues: {},
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    createdBy: null,
    intakeOwnerId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    isDeleted: false,
    workflowTemplateId: standardCremationWorkflowTemplateFixture.id,
    workflowTemplateVersion: SNAPSHOT_VERSION.version,
    caseType: 'cremation',
    workflowSnapshot: buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, SNAPSHOT_VERSION),
  };
  return { ...base, ...overrides };
}

/** Every index needed to fully satisfy the "First Call & Payment" stage
    (raw 0 AND its redundant raw-1 twin — see workflowTemplates.ts's own
    comment on why both exist with identical 11-item lists), regardless of
    which of the two hasField variants is active for a given rawStage.
    Checklist default-done fix (2026-10): rawStage 0's StageTemplate has
    hasField:true for items 0-7 (isFirstCallStage(0)), satisfied below via
    fieldValues — but rawStage 1's StageTemplate carries the SAME 11
    labels with hasField:false for all of them (isFirstCallStage(1) is
    false), and `computeFirstIncompleteRawStage` evaluates both
    StageTemplate entries (same displayStage 0, same composite keys).
    Previously items 0-7 of the rawStage-1 variant were credited for free
    by defaultDone; now every index needs an explicit checklistState
    entry, not just the historical 8/9/10. */
function fullyCompleteFirstCallAndPayment(): Pick<Case, 'fieldValues' | 'checklistState'> {
  return {
    fieldValues: { 0: 'X', 1: 'X', 2: 'X', 3: 'X', 4: 'X', 5: 'X', 6: 'X', 7: 'X', 9: 'X', 10: 'X' },
    // displayStage 0 (First Call & Payment, combined 11-item checklist) —
    // composite-keyed per B2026-035's fix (domain/workflow/checklistItemKey.ts).
    checklistState: {
      '0:0': true,
      '0:1': true,
      '0:2': true,
      '0:3': true,
      '0:4': true,
      '0:5': true,
      '0:6': true,
      '0:7': true,
      '0:8': true,
      '0:9': true,
      '0:10': true,
    },
  };
}

function linkArrangementForm(caseId: string): void {
  const link: CaseFormLink = {
    id: `link-${caseId}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId,
    provider: 'jotform',
    formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID,
    linkTokenHash: 'hash',
    status: 'received',
    sentAt: '2026-01-01T00:00:00.000Z',
    submissionId: `sub-${caseId}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  caseFormLinkFixtures.push(link);
}

const pushedCaseIds: string[] = [];
function seedCase(case_: Case): void {
  caseFixtures.push(case_);
  pushedCaseIds.push(case_.id);
}

afterEach(() => {
  for (const id of pushedCaseIds.splice(0)) {
    const index = caseFixtures.findIndex((c) => c.id === id);
    if (index !== -1) caseFixtures.splice(index, 1);
  }
  caseFormLinkFixtures.length = 0;
});

describe('computeFirstIncompleteRawStage — pure computation', () => {
  it('1: a case with the Arrangement Form linked satisfies the Jotform Application prerequisite (stage 2)', () => {
    const case_ = buildTestCase({ ...fullyCompleteFirstCallAndPayment() });
    expect(computeFirstIncompleteRawStage(case_, false)).toBe(2); // not linked yet -> blocked at Jotform Application
    expect(computeFirstIncompleteRawStage(case_, true)).toBe(3); // linked -> advances past it to EDRS
  });

  it('5/6: Arrangement complete + payment done advances to the first genuinely incomplete stage — not a hardcoded 3', () => {
    // Same "First Call & Payment done" starting point, only the Arrangement
    // Form linkage differs — the result genuinely differs (2 vs 3), proving
    // this is computed from real state, never a fixed "always land on 3."
    const notLinked = buildTestCase({ ...fullyCompleteFirstCallAndPayment() });
    expect(computeFirstIncompleteRawStage(notLinked, false)).toBe(2);

    const linked = buildTestCase({ ...fullyCompleteFirstCallAndPayment() });
    expect(computeFirstIncompleteRawStage(linked, true)).toBe(3);

    // And when First Call & Payment itself isn't done yet, the result is
    // neither 2 nor 3 — a third distinct value, ruling out any fixed
    // constant entirely (see the dedicated test below for the full case).
    const nothingDone = buildTestCase();
    expect(computeFirstIncompleteRawStage(nothingDone, true)).toBe(0);
  });

  it('7: an actually incomplete earlier prerequisite (First Call & Payment data-entry fields) still blocks advancement, even with the Arrangement Form linked and payment recorded', () => {
    const case_ = buildTestCase(); // nothing filled in at all
    expect(computeFirstIncompleteRawStage(case_, true)).toBe(0);
  });

  it('never treats a stage as done merely from the OTHER stage-0/1 twin defaulting differently — both are evaluated consistently', () => {
    const case_ = buildTestCase({ rawStage: 1, ...fullyCompleteFirstCallAndPayment() });
    expect(computeFirstIncompleteRawStage(case_, true)).toBe(3);
  });
});

describe('reconcileCaseWorkflow — mock mode', () => {
  it('5: advances rawStage from 0 to 3 (EDRS) once the Arrangement Form is linked and First Call & Payment is complete', async () => {
    const case_ = buildTestCase({ ...fullyCompleteFirstCallAndPayment() });
    seedCase(case_);
    linkArrangementForm(case_.id);

    const result = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');

    expect(result).toEqual({ rawStage: 3, changed: true });
    expect(caseFixtures.find((c) => c.id === case_.id)?.rawStage).toBe(3);
  });

  it('7: does not advance when an earlier prerequisite is genuinely incomplete', async () => {
    const case_ = buildTestCase();
    seedCase(case_);
    linkArrangementForm(case_.id);

    const result = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');

    expect(result).toEqual({ rawStage: 0, changed: false });
  });

  it('8: is idempotent — running it twice in a row yields the same final state, second run reports unchanged', async () => {
    const case_ = buildTestCase({ ...fullyCompleteFirstCallAndPayment() });
    seedCase(case_);
    linkArrangementForm(case_.id);

    const first = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');
    const second = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');

    expect(first).toEqual({ rawStage: 3, changed: true });
    expect(second).toEqual({ rawStage: 3, changed: false });
  });

  it('never regresses a case that was manually advanced further than its computed prerequisites strictly justify', async () => {
    const case_ = buildTestCase({ rawStage: 5 }); // manually advanced far ahead, nothing else filled in
    seedCase(case_);

    const result = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');

    expect(result).toEqual({ rawStage: 5, changed: false });
  });

  it('9: reconciles an already-imported case without any re-import — pure recomputation over existing records', async () => {
    // Simulates the already-imported historical case: created at rawStage 0
    // (matching casesService.create's hardcoded default), its Arrangement
    // Form already linked from import time, payment completed afterward.
    const case_ = buildTestCase({ rawStage: 0, ...fullyCompleteFirstCallAndPayment(), paymentStatus: 'paid_in_full' });
    seedCase(case_);
    linkArrangementForm(case_.id);
    const caseCountBefore = caseFixtures.length;
    const linkCountBefore = caseFormLinkFixtures.length;

    const result = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');

    expect(result.rawStage).toBe(3);
    expect(caseFixtures.length).toBe(caseCountBefore); // no case duplicated/created
    expect(caseFormLinkFixtures.length).toBe(linkCountBefore); // no link duplicated
  });

  it('is a no-op for a nonexistent case id', async () => {
    const result = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, 'no-such-case', 'mock');
    expect(result).toEqual({ rawStage: 0, changed: false });
  });

  it('is a no-op for a case with no workflowSnapshot', async () => {
    const case_ = buildTestCase({ workflowSnapshot: null });
    seedCase(case_);
    const result = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');
    expect(result).toEqual({ rawStage: 0, changed: false });
  });

  it('a Vital Statistics-only link (not Arrangement Forms) does not satisfy the Jotform Application prerequisite', async () => {
    const case_ = buildTestCase({ ...fullyCompleteFirstCallAndPayment() });
    seedCase(case_);
    caseFormLinkFixtures.push({
      id: `link-vital-${case_.id}`,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: case_.id,
      provider: 'jotform',
      formConfigId: VITAL_STATISTICS_FORM_CONFIG_ID,
      linkTokenHash: 'hash',
      status: 'received',
      sentAt: '2026-01-01T00:00:00.000Z',
      submissionId: `sub-vital-${case_.id}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');

    expect(result).toEqual({ rawStage: 2, changed: true }); // advances only to Jotform Application, not past it
  });

  it('14: the resulting rawStage agrees with the effective/display stage buildCaseViewModel computes — "Step 3" as staff would actually see it is EDRS & Doctor / Cause of Death, never a mislabeled stage', async () => {
    const case_ = buildTestCase({ ...fullyCompleteFirstCallAndPayment() });
    seedCase(case_);
    linkArrangementForm(case_.id);

    const result = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');
    expect(result.rawStage).toBe(3);

    const persisted = caseFixtures.find((c) => c.id === case_.id)!;
    const viewModel = buildCaseViewModel(persisted, { staffList: [] });
    expect(viewModel.displayStage).toBe(2); // toDisplayStage(3) — First Call & Payment(0), Jotform Application(1), EDRS & Doctor / Cause of Death(2)
    expect(viewModel.stageLabel).toBe('EDRS & Doctor / Cause of Death');
  });

  it('a link with status other than received/reviewed (e.g. "sent") does not satisfy the prerequisite', async () => {
    const case_ = buildTestCase({ ...fullyCompleteFirstCallAndPayment() });
    seedCase(case_);
    caseFormLinkFixtures.push({
      id: `link-sent-${case_.id}`,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: case_.id,
      provider: 'jotform',
      formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID,
      linkTokenHash: 'hash',
      status: 'sent',
      sentAt: '2026-01-01T00:00:00.000Z',
      submissionId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');

    expect(result).toEqual({ rawStage: 2, changed: true });
  });
});

/**
 * B2026-035 regression suite (2026-10-01) — stage-scoped checklistState.
 *
 * Root cause (fixed): `Case.checklistState` used to be one flat
 * `Record<number, boolean>` map, reused by raw numeric index across EVERY
 * stage's own checklist — never namespaced per stage. An index explicitly
 * completed for one stage could be silently reinterpreted as satisfying a
 * DIFFERENT stage's unrelated item at that same index.
 *
 * Confirmed against B2026-035's real persisted data (read-only Wix query,
 * 2026-10-01): explicitly completing "Authorization of release sent to
 * crematory" (Permit & Authorization stage, rawStage 4, local index 1)
 * persisted the old flat `checklistState[1] = true`. "DC Application
 * Sent" (rawStage 5) also has exactly 2 items, and its own last item —
 * "Sent day before ashes arrive" — is ALSO local index 1, so the same
 * `true` incorrectly satisfied it too, skipping rawStage 5 entirely.
 *
 * The fix: `checklistState` is now keyed by composite
 * "{displayStage}:{index}" (domain/workflow/checklistItemKey.ts) — scoped
 * by *display* stage, not raw stage, so First Call (rawStage 0) and
 * Payment (rawStage 1) keep intentionally sharing one key (both map to
 * displayStage 0), while Permit (rawStage 4 → displayStage 3) and DC
 * Application Sent (rawStage 5 → displayStage 4) — genuinely different
 * work that merely shares local index 1 — can never collide. These tests
 * assert the corrected behavior directly — no `.fails()` modifier. Display
 * stage numbers below use this template's real raw→display mapping
 * (`toDisplayStage(rawStage) = rawStage === 0 ? 0 : rawStage - 1`, see
 * services/__mocks__/workflowTemplates.ts): EDRS (raw 3) → display 2,
 * Permit (raw 4) → display 3, DC Application Sent (raw 5) → display 4,
 * Ready for Pickup (raw 6) → display 5.
 */
describe('B2026-035 regression — stage-scoped checklistState prevents cross-stage index collisions', () => {
  /** Mirrors B2026-035 exactly up through "genuinely ready to leave
      Permit & Authorization": First Call & Payment and EDRS both fully,
      legitimately complete via their own composite-keyed items,
      Arrangement Form linked, Permit stage's own last item (displayStage
      3, local index 1) explicitly done — the exact action that triggered
      B2026-035's over-advancement, now correctly scoped to display stage
      3 only. */
  function caseReadyToLeavePermitStage(): Case {
    return buildTestCase({
      rawStage: 4,
      ...fullyCompleteFirstCallAndPayment(),
      checklistState: {
        ...fullyCompleteFirstCallAndPayment().checklistState,
        // EDRS (displayStage 2) and Permit (displayStage 3) each require
        // EVERY item explicitly done now, not just their own last one —
        // checklist default-done fix (2026-10) retired the old free credit
        // for non-last items.
        '2:0': true,
        '2:1': true,
        '2:2': true, // EDRS's own last item ("Hardsave for state approval…")
        '3:0': true,
        '3:1': true, // Permit's own last item ("Authorization of release…")
      },
    });
  }

  it('1. reconciliation advances exactly one stage — to DC Application Sent (5) — never past it', () => {
    const case_ = caseReadyToLeavePermitStage();
    expect(computeFirstIncompleteRawStage(case_, true)).toBe(5);
  });

  it('2. DC Application Sent\'s own "Sent day before ashes arrive" item is NOT done merely because Permit\'s unrelated item shares local index 1', () => {
    const case_ = caseReadyToLeavePermitStage();
    const dcStage = case_.workflowSnapshot!.stages.find((s) => s.rawStage === 5)!;
    const resolved = resolveChecklist(dcStage.checklist.items, dcStage.displayStage, case_, { isPastStage: false });
    expect(resolved[1].done).toBe(false); // "Sent day before ashes arrive" — never actually completed
  });

  it('3. Permit & Authorization\'s own item 1 still reads done, scoped correctly to its display stage (3)', () => {
    const case_ = caseReadyToLeavePermitStage();
    const permitStage = case_.workflowSnapshot!.stages.find((s) => s.rawStage === 4)!;
    const resolved = resolveChecklist(permitStage.checklist.items, permitStage.displayStage, case_, { isPastStage: false });
    expect(resolved[1].done).toBe(true);
  });

  it('4. reconcileCaseWorkflow (full mock-mode path) advances by exactly one stage, not two', async () => {
    const case_ = caseReadyToLeavePermitStage();
    seedCase(case_);
    linkArrangementForm(case_.id);

    const result = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');
    expect(result).toEqual({ rawStage: 5, changed: true });
  });

  it('5. an incomplete DC Application Sent prerequisite correctly blocks advancement to Ready for Pickup', () => {
    const case_ = caseReadyToLeavePermitStage();
    expect(computeFirstIncompleteRawStage(case_, true)).not.toBe(6);
  });

  it('6. a genuinely complete DC Application Sent (its own composite-keyed item explicitly done) correctly advances past it — real completion is now distinguishable from collision', () => {
    const case_ = buildTestCase({
      rawStage: 4,
      ...fullyCompleteFirstCallAndPayment(),
      checklistState: {
        ...fullyCompleteFirstCallAndPayment().checklistState,
        '2:0': true,
        '2:1': true,
        '2:2': true, // EDRS
        '3:0': true,
        '3:1': true, // Permit
        '4:0': true,
        '4:1': true, // DC Application Sent — genuinely, independently completed (displayStage 4)
      },
    });
    expect(computeFirstIncompleteRawStage(case_, true)).toBe(6);
  });

  it('7. repeated/idempotent PATCH of the same Permit item never advances further on a second call', async () => {
    const case_ = caseReadyToLeavePermitStage();
    seedCase(case_);
    linkArrangementForm(case_.id);

    const first = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');
    const second = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');

    expect(first).toEqual({ rawStage: 5, changed: true });
    expect(second).toEqual({ rawStage: 5, changed: false });
  });

  it('8. isolated, minimal reproduction: two unrelated stages sharing local index 1 no longer collide once each writes its own composite key', () => {
    const stageAItems = [
      { index: 0, label: 'A - item 0 (never touched)', hasField: false },
      { index: 1, label: 'A - item 1 (the real action taken)', hasField: false },
    ];
    const stageBItems = [
      { index: 0, label: 'B - item 0 (never touched)', hasField: false },
      { index: 1, label: 'B - item 1 (never touched by anyone)', hasField: false },
    ];
    // Composite keys (displayStage 100 for A, 101 for B — arbitrary, chosen
    // to prove this is generic and not specific to Permit/DC's 3/4) — only
    // stage A's item 1 was ever explicitly set.
    const case_ = buildTestCase({ checklistState: { '100:1': true } });

    const resolvedA = resolveChecklist(stageAItems, 100, case_, { isPastStage: false });
    const resolvedB = resolveChecklist(stageBItems, 101, case_, { isPastStage: false });

    expect(resolvedA[1].done).toBe(true); // correct: this is what was actually done
    expect(resolvedB[1].done).toBe(false); // fixed: "never touched by anyone" no longer reads as done
  });

  it('9. a bare numeric key is NEVER honored, even for the case\'s own current display stage — the legacy read fallback has been fully retired post-migration', () => {
    const case_ = buildTestCase({ rawStage: 4, checklistState: { '1': true } });
    const permitStage = case_.workflowSnapshot!.stages.find((s) => s.rawStage === 4)!;
    const resolved = resolveChecklist(permitStage.checklist.items, permitStage.displayStage, case_, { isPastStage: false });
    // Every item now requires explicit evidence of completion (checklist
    // default-done fix, 2026-10) — with no composite key and no legacy
    // fallback, Permit's item 1 correctly reads NOT done, never assumed
    // from the bare "1".
    expect(resolved[1].done).toBe(false);
  });

  it('10. a bare numeric key is NEVER honored for any stage, current or otherwise — never guessed, under any circumstance', () => {
    const case_ = buildTestCase({ rawStage: 4, checklistState: { '1': true } });
    const dcStage = case_.workflowSnapshot!.stages.find((s) => s.rawStage === 5)!;
    const resolved = resolveChecklist(dcStage.checklist.items, dcStage.displayStage, case_, { isPastStage: false });
    expect(resolved[1].done).toBe(false); // ambiguous legacy key — falls back to defaultDone, never assumed
  });

  it('11. a stage strictly before the case\'s current display stage is never re-evaluated, even if its checklistState would otherwise read as incomplete', () => {
    // rawStage sits at 6 (displayStage 5); checklistState is entirely
    // empty, so Permit's own gating item (displayStage 3) would read as
    // completely undone if it were ever re-evaluated — but displayStage 3
    // is strictly before displayStage 5, so computeFirstIncompleteRawStage
    // must skip it entirely rather than regress to reporting rawStage 4 as
    // "first incomplete."
    const case_ = buildTestCase({ rawStage: 6 });
    expect(computeFirstIncompleteRawStage(case_, true)).not.toBe(4);
    expect(computeFirstIncompleteRawStage(case_, true)).toBe(6); // Ready for Pickup itself — its own item never explicitly done
  });

  it('12. the Jotform overlay (Arrangement Form linked) writes its composite key scoped to the Jotform stage only, never bleeding into another stage\'s same local index', () => {
    const case_ = buildTestCase({ ...fullyCompleteFirstCallAndPayment() });
    // Jotform Application (rawStage 2, displayStage 1) has exactly 1 item
    // at local index 0; Family picked up ashes (rawStage 7, "Completed",
    // displayStage 6) also has exactly 1 item at local index 0 — the
    // overlay must only ever mark the Jotform stage's own item, never
    // Completed's.
    expect(computeFirstIncompleteRawStage(case_, true)).toBe(3); // advances past Jotform via the overlay
    expect(computeFirstIncompleteRawStage(case_, true)).not.toBe(7); // never jumps all the way to Completed
  });

  it('13. toggling the same item to the same value twice is idempotent and does not advance rawStage again', async () => {
    const case_ = caseReadyToLeavePermitStage();
    seedCase(case_);
    linkArrangementForm(case_.id);

    const first = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');
    expect(first).toEqual({ rawStage: 5, changed: true });

    // Simulates the UI re-sending the exact same composite-keyed patch
    // (e.g. a duplicate/retried PATCH) — the persisted state doesn't
    // change, so reconciliation must report no further change.
    const stillPermit = caseFixtures.find((c) => c.id === case_.id)!;
    stillPermit.checklistState = { ...stillPermit.checklistState, '3:1': true };
    const second = await reconcileCaseWorkflow(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');
    expect(second).toEqual({ rawStage: 5, changed: false });
  });

  it('14. a multi-stage historical-import jump still works when every skipped stage is genuinely, independently complete via its own composite keys', () => {
    const case_ = buildTestCase({
      rawStage: 0,
      ...fullyCompleteFirstCallAndPayment(),
      checklistState: {
        ...fullyCompleteFirstCallAndPayment().checklistState,
        '2:0': true,
        '2:1': true,
        '2:2': true, // EDRS (displayStage 2)
        '3:0': true,
        '3:1': true, // Permit (displayStage 3)
        '4:0': true,
        '4:1': true, // DC Application Sent — genuinely complete, own key (displayStage 4)
      },
    });
    // Jumps straight to Ready for Pickup (6) in one computation — every
    // intermediate stage (2, 3, 4, 5) is independently, genuinely done.
    expect(computeFirstIncompleteRawStage(case_, true)).toBe(6);
  });

  it('15. writeChecklistValue + resolveChecklist round-trip: toggling via the real write helper is correctly read back, scoped to the right display stage only', () => {
    const base = buildTestCase({ rawStage: 4 }); // displayStage 3
    const patched = writeChecklistValue(base.checklistState, 3, 1, true);
    const case_ = { ...base, checklistState: patched };

    const permitStage = case_.workflowSnapshot!.stages.find((s) => s.rawStage === 4)!; // displayStage 3
    const dcStage = case_.workflowSnapshot!.stages.find((s) => s.rawStage === 5)!; // displayStage 4
    expect(resolveChecklist(permitStage.checklist.items, permitStage.displayStage, case_, { isPastStage: false })[1].done).toBe(true);
    expect(resolveChecklist(dcStage.checklist.items, dcStage.displayStage, case_, { isPastStage: false })[1].done).toBe(false);
  });

  it('16. UNCHECK direction — toggling a different stage\'s same-local-index item to false never collaterally clears a genuinely completed item (reproduces the EDRS collateral-corruption finding)', () => {
    // Reproduces the real B2026-035 timeline shape: EDRS (displayStage 2,
    // local index 2) was genuinely, independently completed. Staff later
    // unchecked what they believed was Ready for Pickup's own item at
    // local index 2 (reacting to the bogus Stage 6 display) — under the
    // old flat-key architecture this used the SAME key as EDRS's own item
    // 2 and collaterally cleared it. Under the composite-key fix, writing
    // Ready for Pickup's own key must never touch EDRS's own key.
    const base = caseReadyToLeavePermitStage(); // EDRS ('2:2') and Permit ('3:1') both genuinely done
    const readyForPickupUnchecked = writeChecklistValue(base.checklistState, 5, 2, false); // Ready for Pickup's own item 2 -> false
    const case_ = { ...base, checklistState: readyForPickupUnchecked };

    const edrsStage = case_.workflowSnapshot!.stages.find((s) => s.rawStage === 3)!; // displayStage 2
    const resolvedEdrs = resolveChecklist(edrsStage.checklist.items, edrsStage.displayStage, case_, { isPastStage: false });
    expect(resolvedEdrs[2].done).toBe(true); // EDRS's own completion survives the unrelated uncheck untouched

    // Reconciliation still correctly advances to DC Application Sent (5) —
    // the uncheck on Ready for Pickup's own item has zero effect on EDRS,
    // Permit, or the computed first-incomplete stage.
    expect(computeFirstIncompleteRawStage(case_, true)).toBe(5);
  });
});
