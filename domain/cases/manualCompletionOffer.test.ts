import { describe, expect, it } from 'vitest';
import { manualCompletionOffer, showsRemainsReturnControls } from './manualCompletionOffer';
import {
  completionItemOptions,
  finalItemsCompletionPolicy,
  remainsReturnCompletionPolicy,
  setManualCompletion,
} from '../workflow/completionPolicy';
import { burialStages, burialTemplate, burialVersion, caseOn, direct, directV } from '../workflow/crossServiceRegression.fixtures';
import { checklistItemKey } from '../workflow/checklistItemKey';
import { caseFixtures } from '../../services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '../../services/__mocks__/organizationIds';
import type { Case } from '../../types/case';
import type { ManualCompletionPermission, WorkflowCompletionPolicy } from '../../types/workflowTemplate';

/**
 * Service-specific completion (2026-10) — the Case Detail derivations:
 * when "Mark completed" is offered, what its confirmation shows, and when
 * the remains-return controls are shown. Fictional cases only.
 */

const committal = () => completionItemOptions(burialStages()).find((o) => o.ref.label === 'Fictional committal confirmed')!.ref;

function burialPolicy(manual: { allowed: boolean; permission?: ManualCompletionPermission } = { allowed: true }): WorkflowCompletionPolicy {
  return setManualCompletion(finalItemsCompletionPolicy({ requiredFinalItems: [committal()] }), manual);
}

function burialCase(policy: WorkflowCompletionPolicy | undefined, rawStage = 5, overrides: Partial<Case> = {}): Case {
  const version = { ...burialVersion(1, burialStages()), ...(policy ? { completionPolicy: policy } : {}) };
  return { ...caseOn(burialTemplate([version]), version, 'bu-offer', rawStage), ...overrides };
}

const ADMIN = ['case.read', 'case.update', 'case.delete'];
const EDITOR = ['case.read', 'case.update'];

describe('manualCompletionOffer', () => {
  it('is offered for a burial whose policy allows it, to a viewer holding the default permission (case.delete)', () => {
    const offer = manualCompletionOffer(burialCase(burialPolicy()), ADMIN);
    expect(offer).not.toBeNull();
    expect(offer!.permission).toBe('case.delete');
    expect(offer!.blockedReason).toBeNull();
    expect(offer!.unmet.map((r) => r.label)).toEqual(['Fictional committal confirmed']);
    expect(offer!.policyLines[0]).toMatch(/No cremated remains are returned/);
  });

  it('is not offered without the policy’s permission', () => {
    expect(manualCompletionOffer(burialCase(burialPolicy()), EDITOR)).toBeNull();
    expect(manualCompletionOffer(burialCase(burialPolicy()), null)).toBeNull();
  });

  it('honours a policy gated by case.update', () => {
    expect(manualCompletionOffer(burialCase(burialPolicy({ allowed: true, permission: 'case.update' })), EDITOR)?.permission).toBe('case.update');
  });

  it('is not offered when the policy does not allow manual completion', () => {
    expect(manualCompletionOffer(burialCase(burialPolicy({ allowed: false })), ADMIN)).toBeNull();
  });

  it('is not offered for Direct Cremation (its policy never allows it)', () => {
    expect(manualCompletionOffer(caseOn(direct, directV, 'dc-offer', 7), ADMIN)).toBeNull();
  });

  it('is not offered for a legacy / Manors case (no policy on its snapshot)', () => {
    const manors = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID)!;
    expect(manors.workflowSnapshot?.completionPolicy).toBeUndefined();
    expect(manualCompletionOffer(manors, ADMIN)).toBeNull();
    expect(manualCompletionOffer(burialCase(undefined), ADMIN)).toBeNull();
  });

  it('is not offered once the case is already complete, or archived', () => {
    const done = burialCase(burialPolicy(), 5, { checklistState: { [checklistItemKey(4, 0)]: true } });
    expect(manualCompletionOffer(done, ADMIN)).toBeNull();
    expect(manualCompletionOffer(burialCase(burialPolicy(), 5, { isDeleted: true }), ADMIN)).toBeNull();
  });

  it('is offered but blocked (with the reason) when the case is not yet near its final stage', () => {
    const offer = manualCompletionOffer(burialCase(burialPolicy(), 2), ADMIN);
    expect(offer?.blockedReason).toMatch(/final stage, or the stage just before it/);
    expect(offer?.reasons).toContain('The case has not reached its final stage.');
  });

  it('is blocked when the policy requires the return of remains and it is not recorded — never bypassed', () => {
    const policy = setManualCompletion(remainsReturnCompletionPolicy(), { allowed: true });
    const waiting = manualCompletionOffer(burialCase(policy), ADMIN);
    expect(waiting?.blockedReason).toBe('The return of cremated remains must be recorded before this case can be completed.');
    expect(waiting?.unmet.map((r) => r.key)).toEqual(['remains_return']);
  });
});

describe('showsRemainsReturnControls', () => {
  it('is false only for a policy that returns no remains', () => {
    expect(showsRemainsReturnControls(burialCase(burialPolicy()))).toBe(false);
  });

  it('is true for cremation, legacy (no policy), Manors, and an unknown case', () => {
    expect(showsRemainsReturnControls(caseOn(direct, directV, 'dc-show', 7))).toBe(true);
    expect(showsRemainsReturnControls(burialCase(undefined))).toBe(true);
    expect(showsRemainsReturnControls(caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID)!)).toBe(true);
    expect(showsRemainsReturnControls(null)).toBe(true);
    expect(showsRemainsReturnControls({ workflowSnapshot: undefined } as unknown as Case)).toBe(true);
  });
});
