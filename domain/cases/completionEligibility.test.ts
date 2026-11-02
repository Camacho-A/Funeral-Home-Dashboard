import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  archivesOnCompletion,
  completionTransition,
  decideManualCompletion,
  evaluateCaseCompletion,
} from './completionEligibility';
import { isCaseWorkflowComplete } from './workflowCompletion';
import { isTerminalReturnRequirementComplete } from './returnMethod';
import { buildCaseViewModel } from './viewModel';
import { buildCaseWorkflowSnapshot, latestTemplateVersion } from '../workflow/snapshot';
import { findStageByRawStage, lastDisplayStage } from '../workflow/resolveStages';
import { checklistItemKey } from '../workflow/checklistItemKey';
import {
  completionItemOptions,
  finalItemsCompletionPolicy,
  remainsReturnCompletionPolicy,
} from '../workflow/completionPolicy';
import {
  buildGusServiceWorkflowTemplateFixtures,
  secondOrgWorkflowTemplateFixture,
  standardCremationWorkflowTemplateFixture,
} from '../../services/__mocks__/workflowTemplates';
import { caseFixtures } from '../../services/__mocks__/fixtures';
import { reconcileCaseWorkflow } from '../../services/workflowReconciliationService';
import { burialStages, burialTemplate, burialVersion, caseOn, everyBurialItemChecked, GUS } from '../workflow/crossServiceRegression.fixtures';
import type { Case, PickupStatus, ReturnMethod, ShippingDeliveryStatus } from '../../types/case';
import type { WorkflowCompletionPolicy, WorkflowTemplate, WorkflowTemplateVersion } from '../../types/workflowTemplate';

/**
 * Service-specific completion (2026-10). The completion policy evaluator
 * (domain/cases/completionEligibility.ts) and everything that now reads it
 * — isCaseWorkflowComplete, the case view model, the completion
 * transition the archiver keys off. Fictional cases and fictional
 * workflow steps only.
 */

const gusTemplates = buildGusServiceWorkflowTemplateFixtures();
const gusTemplate = (code: string) => gusTemplates.find((t) => t.serviceTypeCodes?.includes(code))!;
const finalRawStage = (version: WorkflowTemplateVersion) => {
  const last = Math.max(...version.stages.map((s) => s.displayStage));
  return Math.max(...version.stages.filter((s) => s.displayStage === last).map((s) => s.rawStage));
};

/** A case on `template`'s latest version, on its final stage unless told otherwise. */
function gusCase(code: string, overrides: Partial<Case> = {}): Case {
  const template = gusTemplate(code);
  const version = template.versions[template.versions.length - 1];
  return caseOn(template, version, `case-${code.toLowerCase()}`, finalRawStage(version), { ...overrides });
}

/** The pre-policy rule, verbatim: last stage AND remains returned. */
function oldRule(case_: Case): boolean {
  const snapshot = case_.workflowSnapshot;
  if (!snapshot) return false;
  const displayStage = findStageByRawStage(snapshot, case_.rawStage)?.displayStage;
  return displayStage !== undefined && displayStage === lastDisplayStage(snapshot) && isTerminalReturnRequirementComplete(case_);
}

/** A fictional burial workflow version carrying `policy`. */
function burialWithPolicy(policy: WorkflowCompletionPolicy): { template: WorkflowTemplate; version: WorkflowTemplateVersion } {
  const version = { ...burialVersion(1, burialStages()), completionPolicy: policy };
  return { template: burialTemplate([version]), version };
}
const committal = () => completionItemOptions(burialStages()).find((o) => o.ref.label === 'Fictional committal confirmed')!.ref;
const serviceHeld = () => completionItemOptions(burialStages()).find((o) => o.ref.label === 'Fictional service held')!.ref;

describe('completion eligibility — each of Gus’ six services (frozen policy)', () => {
  it.each(['DIRECT_CREMATION', 'CREMATION_WITH_FINAL_GOODBYE', 'CREMATION_WITH_VIEWING'])(
    '%s completes on the final stage only once the return of cremated remains is recorded',
    (code) => {
      const waiting = evaluateCaseCompletion(gusCase(code));
      expect(waiting).toMatchObject({ eligible: false, onFinalStage: true, mode: null, isLegacyPolicy: false });
      expect(waiting.policy).toMatchObject({ kind: 'remains_return', requiresRemainsReturn: true, requiredFinalItems: [] });
      expect(waiting.reasons).toEqual(['Outstanding: Return of cremated remains confirmed']);

      const released = evaluateCaseCompletion(gusCase(code, { returnMethod: 'pickup', pickupStatus: 'released' }));
      expect(released).toMatchObject({ eligible: true, mode: 'automatic', reasons: [] });
      const delivered = evaluateCaseCompletion(gusCase(code, { returnMethod: 'shipping', shippingDeliveryStatus: 'delivered' }));
      expect(delivered.eligible).toBe(true);
    },
  );

  it.each(['GRAVESIDE_BURIAL_SERVICE_ONLY', 'VETERANS_GRAVESIDE_BURIAL_SERVICE_ONLY', 'DIRECT_ENTOMBMENT'])(
    '%s never asks for cremated remains, and cannot complete while its final items are undefined',
    (code) => {
      const evaluation = evaluateCaseCompletion(gusCase(code, { returnMethod: 'pickup', pickupStatus: 'released' }));
      expect(evaluation.policy).toMatchObject({ kind: 'final_items', requiresRemainsReturn: false, requiredFinalItems: [] });
      expect(evaluation.requirements.map((r) => r.key)).not.toContain('remains_return');
      expect(evaluation).toMatchObject({ eligible: false, onFinalStage: true });
      expect(evaluation.reasons).toEqual(['The checklist items that complete this service have not been defined.']);
      expect(evaluation.reasons.join(' ')).not.toMatch(/ashes|cremat/i);
    },
  );

  it('a case that has not reached its final stage is never complete, whatever was recorded', () => {
    const early = gusCase('DIRECT_CREMATION', { rawStage: 6, returnMethod: 'pickup', pickupStatus: 'released' });
    expect(evaluateCaseCompletion(early)).toMatchObject({ eligible: false, onFinalStage: false, requirementsMet: true });
    expect(evaluateCaseCompletion(early).reasons[0]).toBe('The case has not reached its final stage.');
  });
});

describe('equivalence — Direct Cremation’s explicit policy and every snapshot without one reproduce today’s rule exactly', () => {
  const returnMethods: ReturnMethod[] = ['undecided', 'pickup', 'shipping'];
  const pickupStatuses: PickupStatus[] = ['awaiting_pickup', 'released'];
  const shippingStatuses: (ShippingDeliveryStatus | null)[] = [null, 'shipped', 'delivered'];

  function matrix(base: Case, rawStages: number[]): Case[] {
    const cases: Case[] = [];
    for (const rawStage of rawStages)
      for (const returnMethod of returnMethods)
        for (const pickupStatus of pickupStatuses)
          for (const shippingDeliveryStatus of shippingStatuses)
            cases.push({ ...base, rawStage, returnMethod, pickupStatus, shippingDeliveryStatus });
    return cases;
  }

  it('Direct Cremation: explicit policy ≡ no policy ≡ the old rule — completion AND the whole view model', () => {
    const direct = gusTemplate('DIRECT_CREMATION');
    const version = direct.versions[direct.versions.length - 1];
    expect(version.completionPolicy).toEqual(remainsReturnCompletionPolicy());
    const explicit = caseOn(direct, version, 'eq-dc', 0);
    expect(explicit.workflowSnapshot!.completionPolicy).toEqual(remainsReturnCompletionPolicy());
    const legacySnapshot = structuredClone(explicit.workflowSnapshot!);
    delete legacySnapshot.completionPolicy;

    const cases = matrix(explicit, version.stages.map((s) => s.rawStage));
    expect(cases.length).toBe(8 * 18);
    for (const withPolicy of cases) {
      const withoutPolicy = { ...withPolicy, workflowSnapshot: legacySnapshot };
      expect(isCaseWorkflowComplete(withPolicy)).toBe(oldRule(withPolicy));
      expect(isCaseWorkflowComplete(withoutPolicy)).toBe(oldRule(withPolicy));
      const a = buildCaseViewModel(withPolicy, { staffList: [] });
      const b = buildCaseViewModel(withoutPolicy, { staffList: [] });
      expect(a).toEqual(b);
      // The case's real stage, always (Beacon, 2026-10) — never held back.
      expect(a.displayStage).toBe(findStageByRawStage(legacySnapshot, withPolicy.rawStage)!.displayStage);
    }
  });

  it('Manors and evergreen: no policy on any snapshot; every fixture case and every matrix case follows the old rule', () => {
    for (const template of [standardCremationWorkflowTemplateFixture, secondOrgWorkflowTemplateFixture]) {
      const version = latestTemplateVersion(template);
      expect(version.completionPolicy).toBeUndefined();
      const snapshot = buildCaseWorkflowSnapshot(template, version);
      expect('completionPolicy' in snapshot).toBe(false);
      const base = { ...caseFixtures.find((c) => c.organizationId === template.organizationId)!, workflowSnapshot: snapshot };
      for (const c of matrix(base, version.stages.map((s) => s.rawStage))) {
        expect(evaluateCaseCompletion(c).isLegacyPolicy).toBe(true);
        expect(isCaseWorkflowComplete(c)).toBe(oldRule(c));
      }
    }
    const nonGus = caseFixtures.filter((c) => c.organizationId !== GUS && c.workflowSnapshot);
    expect(nonGus.length).toBeGreaterThan(0);
    for (const c of nonGus) {
      expect(c.workflowSnapshot!.completionPolicy).toBeUndefined();
      expect(isCaseWorkflowComplete(c)).toBe(oldRule(c));
      const view = buildCaseViewModel(c, { staffList: [] });
      const snapshot = c.workflowSnapshot!;
      expect(view.displayStage).toBe(findStageByRawStage(snapshot, c.rawStage)?.displayStage ?? 0);
    }
  });

  it('an existing snapshot is never rewritten: a policy is copied only from a version that has one', () => {
    const manors = latestTemplateVersion(standardCremationWorkflowTemplateFixture);
    expect(JSON.stringify(buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, manors))).not.toContain('completionPolicy');
    const { template, version } = burialWithPolicy(finalItemsCompletionPolicy({ requiredFinalItems: [committal()] }));
    const snapshot = buildCaseWorkflowSnapshot(template, version);
    expect(snapshot.completionPolicy).toEqual(version.completionPolicy);
    snapshot.completionPolicy!.requiredFinalItems.length = 0;
    expect(version.completionPolicy!.requiredFinalItems).toHaveLength(1); // deep copy
  });
});

describe('burial completes without any return of remains, once its required items are done', () => {
  const { template, version } = burialWithPolicy(finalItemsCompletionPolicy({ requiredFinalItems: [committal()] }));
  const final = finalRawStage(version);

  it('on the final stage: held back until the required final item is done, then Completed — no ashes wording anywhere', () => {
    const waiting = caseOn(template, version, 'bu-wait', final);
    expect(evaluateCaseCompletion(waiting)).toMatchObject({ eligible: false, reasons: ['Outstanding: Fictional committal confirmed'] });
    const waitingView = buildCaseViewModel(waiting, { staffList: [] });
    // Its real stage, and not shown as done until the required item is.
    expect(waitingView.stageLabel).toBe('Completed');
    expect(waitingView.rowSummaryVariant).not.toBe('success');
    expect(waitingView.checklist.map((item) => item.label)).toEqual(['Fictional committal confirmed']);
    expect(waitingView.checklist[0].isDerived).toBeFalsy();
    expect(JSON.stringify(waitingView)).not.toMatch(/ashes|cremated remains/i);

    const done = caseOn(template, version, 'bu-done', final, { checklistState: { [checklistItemKey(4, 0)]: true } });
    expect(done.returnMethod).toBe('undecided');
    expect(evaluateCaseCompletion(done)).toMatchObject({ eligible: true, mode: 'automatic' });
    const doneView = buildCaseViewModel(done, { staffList: [] });
    expect(doneView).toMatchObject({ stageLabel: 'Completed', rowSummaryText: 'Completed', rowSummaryVariant: 'success' });
  });

  it('a required item of the stage before the final one counts too; bulk-advancing past it does not complete the case', () => {
    const policy = finalItemsCompletionPolicy({ requiredFinalItems: [serviceHeld()] });
    const { template: t, version: v } = burialWithPolicy(policy);
    const pushed = caseOn(t, v, 'bu-pushed', finalRawStage(v)); // advanced by hand, item never ticked
    expect(evaluateCaseCompletion(pushed)).toMatchObject({ onFinalStage: true, eligible: false, reasons: ['Outstanding: Fictional service held'] });
    const ticked = { ...pushed, checklistState: { [checklistItemKey(3, 0)]: true } };
    expect(evaluateCaseCompletion(ticked).eligible).toBe(true);
  });

  it('a final-items policy with nothing chosen never completes — not even on its final stage with everything ticked', () => {
    const { template: t, version: v } = burialWithPolicy(finalItemsCompletionPolicy());
    const c = caseOn(t, v, 'bu-undefined', finalRawStage(v), { checklistState: everyBurialItemChecked() });
    expect(evaluateCaseCompletion(c)).toMatchObject({ eligible: false, requirementsMet: false });
    expect(buildCaseViewModel(c, { staffList: [] }).nextActionLabel).not.toBe('Review case');
  });
});

describe('automatic advancement into Completed', () => {
  const { template, version } = burialWithPolicy(finalItemsCompletionPolicy({ requiredFinalItems: [committal()] }));
  let before: Case[];
  beforeEach(() => {
    before = structuredClone(caseFixtures);
  });
  afterEach(() => {
    caseFixtures.splice(0, caseFixtures.length, ...before);
  });

  it('reconciliation moves a fully-checked burial case onto its final stage, where its policy completes it; the transition archives it', async () => {
    const start = caseOn(template, version, 'bu-auto', 4, { checklistState: everyBurialItemChecked() });
    caseFixtures.push(start);
    expect(evaluateCaseCompletion(start).eligible).toBe(false);

    const result = await reconcileCaseWorkflow(GUS, 'bu-auto', 'mock');
    expect(result).toMatchObject({ rawStage: finalRawStage(version), changed: true });
    const after = caseFixtures.find((c) => c.id === 'bu-auto')!;
    expect(evaluateCaseCompletion(after)).toMatchObject({ eligible: true, mode: 'automatic' });
    expect(buildCaseViewModel(after, { staffList: [] }).stageLabel).toBe('Completed');
    expect(completionTransition(start, after)).toMatchObject({ becameComplete: true, mode: 'automatic', archive: true });
    // Idempotent: already complete -> no second transition.
    expect(completionTransition(after, after).becameComplete).toBe(false);
  });
});

describe('archive eligibility (policy-driven)', () => {
  it('archives on completion by default — today’s behaviour — and not when the policy says staff archive by hand', () => {
    const onCompletion = burialWithPolicy(finalItemsCompletionPolicy({ requiredFinalItems: [committal()] }));
    const manual = burialWithPolicy({ ...finalItemsCompletionPolicy({ requiredFinalItems: [committal()] }), archiveEligibility: 'manual' });
    for (const [setup, archives] of [[onCompletion, true], [manual, false]] as const) {
      const final = finalRawStage(setup.version);
      const before = caseOn(setup.template, setup.version, 'bu-arch', final);
      const after = { ...before, checklistState: { [checklistItemKey(4, 0)]: true } };
      expect(archivesOnCompletion(after)).toBe(archives);
      expect(completionTransition(before, after)).toMatchObject({ becameComplete: true, archive: archives });
    }
    // No policy: archives, exactly as before.
    const manors = caseFixtures.find((c) => c.organizationId === 'managed-cremations')!;
    expect(archivesOnCompletion(manors)).toBe(true);
  });
});

describe('manual completion (decision)', () => {
  const manualPolicy = { ...finalItemsCompletionPolicy({ requiredFinalItems: [committal()] }), manualCompletion: { allowed: true, permission: 'case.delete' as const } };
  const { template, version } = burialWithPolicy(manualPolicy);
  const final = finalRawStage(version);
  const input = { actorHasPermission: true, actorIdentityId: 'identity-fictional-owner', actorName: 'Example Owner', reason: 'Fictional: committal confirmed by phone', now: '2026-10-15T12:00:00.000Z' };

  it('completes a case on its final stage without its checklist item — recorded as manual, with who/when/why', () => {
    const c = caseOn(template, version, 'bu-manual', final, { daysWaitingInStage: 3 });
    const decision = decideManualCompletion(c, input);
    expect(decision).toMatchObject({
      allowed: true,
      permission: 'case.delete',
      patch: { rawStage: final, daysWaitingInStage: 3, manualCompletion: { completedBy: 'identity-fictional-owner', completedByName: 'Example Owner', reason: 'Fictional: committal confirmed by phone' } },
    });
    if (!decision.allowed) throw new Error('unreachable');
    const completed = { ...c, ...decision.patch };
    expect(evaluateCaseCompletion(completed)).toMatchObject({ eligible: true, mode: 'manual' });
    expect(completionTransition(c, completed)).toMatchObject({ becameComplete: true, mode: 'manual', archive: true });
  });

  it('moves a case on the stage just before the final one onto it; refuses earlier stages', () => {
    const before = caseOn(template, version, 'bu-m2', final - 1);
    const decision = decideManualCompletion(before, input);
    expect(decision).toMatchObject({ allowed: true, patch: { rawStage: final, daysWaitingInStage: 0 } });
    expect(decideManualCompletion(caseOn(template, version, 'bu-m3', 2), input)).toMatchObject({ allowed: false, status: 422 });
  });

  it('refuses: not allowed by the policy (422), no permission (403), already complete / archived (409), no reason (422)', () => {
    const notAllowed = burialWithPolicy(finalItemsCompletionPolicy({ requiredFinalItems: [committal()] }));
    expect(decideManualCompletion(caseOn(notAllowed.template, notAllowed.version, 'x', final), input)).toMatchObject({ allowed: false, status: 422 });
    expect(decideManualCompletion(caseOn(template, version, 'x', final), { ...input, actorHasPermission: false })).toMatchObject({ allowed: false, status: 403 });
    const done = caseOn(template, version, 'x', final, { checklistState: { [checklistItemKey(4, 0)]: true } });
    expect(decideManualCompletion(done, input)).toMatchObject({ allowed: false, status: 409 });
    expect(decideManualCompletion({ ...caseOn(template, version, 'x', final), isDeleted: true }, input)).toMatchObject({ allowed: false, status: 409 });
    expect(decideManualCompletion(caseOn(template, version, 'x', final), { ...input, reason: '  ' })).toMatchObject({ allowed: false, status: 422 });
  });

  it('never stands in for the return of cremated remains', () => {
    const cremation = { ...remainsReturnCompletionPolicy(), manualCompletion: { allowed: true } };
    const t = { ...gusTemplate('CREMATION_WITH_VIEWING') };
    const v = { ...t.versions[0], completionPolicy: cremation };
    t.versions = [v];
    const waiting = caseOn(t, v, 'cr-manual', finalRawStage(v));
    expect(decideManualCompletion(waiting, input)).toMatchObject({ allowed: false, status: 422, error: expect.stringMatching(/return of cremated remains/) });
    // Even a recorded manual completion does not complete it without the remains.
    expect(evaluateCaseCompletion({ ...waiting, manualCompletion: { completedAt: input.now, completedBy: 'x', reason: 'x' } }).eligible).toBe(false);
  });

  it('Direct Cremation and every snapshot without a policy never allow it', () => {
    expect(decideManualCompletion(gusCase('DIRECT_CREMATION'), input)).toMatchObject({ allowed: false, status: 422 });
    const manors = caseFixtures.find((c) => c.organizationId === 'managed-cremations' && c.workflowSnapshot)!;
    expect(decideManualCompletion(manors, input)).toMatchObject({ allowed: false });
    // A stray manualCompletion on a legacy case changes nothing.
    expect(isCaseWorkflowComplete({ ...manors, manualCompletion: { completedAt: input.now, completedBy: 'x', reason: 'x' } })).toBe(oldRule(manors));
  });
});

