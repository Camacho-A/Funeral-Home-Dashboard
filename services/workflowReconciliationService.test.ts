import { afterEach, describe, expect, it } from 'vitest';
import { reconcileCaseWorkflow, computeFirstIncompleteRawStage } from './workflowReconciliationService';
import { caseFixtures, DEFAULT_ORGANIZATION_ID } from './__mocks__/fixtures';
import { caseFormLinkFixtures, ARRANGEMENT_FORMS_FORM_CONFIG_ID, VITAL_STATISTICS_FORM_CONFIG_ID } from './__mocks__/externalFormFixtures';
import { standardCremationWorkflowTemplateFixture } from './__mocks__/workflowTemplates';
import { buildCaseWorkflowSnapshot, latestTemplateVersion } from '../domain/workflow/snapshot';
import type { Case } from '../types/case';
import type { CaseFormLink } from '../types/caseFormLink';

/**
 * Manors workflow reconciliation (2026-09). Covers the checkpoint's
 * "TESTS — WORKFLOW" list items 1, 2 (same mechanism as normal receipt —
 * exercised via the route-level historical-import test separately), 3
 * (implicitly, via paymentWorkflow.test.ts), 5, 6, 7, 8, 9.
 */

const SNAPSHOT_VERSION = latestTemplateVersion(standardCremationWorkflowTemplateFixture);

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
    which of the two hasField variants is active for a given rawStage. */
function fullyCompleteFirstCallAndPayment(): Pick<Case, 'fieldValues' | 'checklistState'> {
  return {
    fieldValues: { 0: 'X', 1: 'X', 2: 'X', 3: 'X', 4: 'X', 5: 'X', 6: 'X', 7: 'X', 9: 'X', 10: 'X' },
    checklistState: { 8: true, 9: true, 10: true },
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
