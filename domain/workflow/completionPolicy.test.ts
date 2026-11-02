import { describe, expect, it } from 'vitest';
import {
  completionItemOptions,
  describeCompletionPolicy,
  effectiveCompletionPolicy,
  finalItemsCompletionPolicy,
  findUnmodifiedCopySource,
  isPlaceholderStageLabel,
  LEGACY_COMPLETION_POLICY,
  parseCompletionPolicy,
  remainsReturnCompletionPolicy,
  setManualCompletion,
  setRemainsReturnRequired,
  staleRequiredFinalItems,
  toggleRequiredFinalItem,
  validateCompletionPolicy,
} from './completionPolicy';
import { validateWorkflowStages } from './templateValidation';
import { addChecklistItem, removeChecklistItem, updateChecklistItem, updateStage } from './templateEditing';
import { buildGusServiceWorkflowTemplateFixtures } from '../../services/__mocks__/workflowTemplates';
import { burialStages } from './crossServiceRegression.fixtures';
import type { WorkflowTemplate } from '../../types/workflowTemplate';

/**
 * Service-specific completion & unfinished-workflow protection (2026-10).
 * The configuration side of completion policies — defaults, editor
 * operations, validation — and the placeholder / unmodified-copy checks
 * approval runs. Fictional workflow steps only.
 */

const gus = buildGusServiceWorkflowTemplateFixtures();
const byCode = (templates: WorkflowTemplate[], code: string) => templates.find((t) => t.serviceTypeCodes?.includes(code))!;
const codes = (problems: { code: string }[]) => problems.map((p) => p.code);

describe('defaults', () => {
  it('no policy means today’s rule: the return of remains, nothing else, no manual completion, archive on completion', () => {
    expect(effectiveCompletionPolicy(undefined)).toEqual({
      kind: 'remains_return',
      requiresRemainsReturn: true,
      requiredFinalItems: [],
      manualCompletion: { allowed: false },
      archiveEligibility: 'on_completion',
    });
    expect(effectiveCompletionPolicy({})).toEqual(LEGACY_COMPLETION_POLICY);
    expect(Object.isFrozen(LEGACY_COMPLETION_POLICY)).toBe(true);
    // A fresh copy every time.
    expect(effectiveCompletionPolicy(undefined)).not.toBe(effectiveCompletionPolicy(undefined));
  });
});

describe('Gus’ per-service policies (2026-11: the cremation services use the shared process; burial/entombment are drafts)', () => {
  it.each([
    ['DIRECT_CREMATION', 'approved', 'remains_return'],
    ['CREMATION_WITH_FINAL_GOODBYE', 'approved', 'remains_return'],
    ['CREMATION_WITH_VIEWING', 'approved', 'remains_return'],
    ['GRAVESIDE_BURIAL_SERVICE_ONLY', 'draft', 'final_items'],
    ['VETERANS_GRAVESIDE_BURIAL_SERVICE_ONLY', 'draft', 'final_items'],
    ['DIRECT_ENTOMBMENT', 'draft', 'final_items'],
  ] as const)('%s — %s, %s', (code, status, kind) => {
    const template = byCode(gus, code);
    const version = template.versions[template.versions.length - 1];
    expect(version.status).toBe(status);
    expect(version.completionPolicy).toMatchObject({ kind, requiresRemainsReturn: kind === 'remains_return', requiredFinalItems: [], manualCompletion: { allowed: false } });
    if (kind === 'final_items') expect(version.completionPolicy!.note).toMatch(/Service-specific completion requirements to be defined/);
    // No cremation wording on a burial/entombment completion path.
    if (kind === 'final_items') {
      const last = version.stages[version.stages.length - 1];
      expect(JSON.stringify([last.label, last.checklist.items.map((i) => i.label)])).not.toMatch(/ashes|cremat/i);
    }
  });
});

describe('editor operations', () => {
  const stages = burialStages();

  it('offers only the final stage’s and the previous stage’s own items', () => {
    expect(completionItemOptions(stages).map((o) => [o.stageLabel, o.ref.label])).toEqual([
      ['Graveside Service Held', 'Fictional service held'],
      ['Completed', 'Fictional committal confirmed'],
    ]);
    expect(completionItemOptions(byCode(gus, 'GRAVESIDE_BURIAL_SERVICE_ONLY').versions[0].stages)).toEqual([]);
  });

  it('toggles required items, keeps kind and remains-return together, and defaults the manual permission', () => {
    const [held, committal] = completionItemOptions(stages).map((o) => o.ref);
    let policy = finalItemsCompletionPolicy();
    policy = toggleRequiredFinalItem(policy, committal);
    policy = toggleRequiredFinalItem(policy, held);
    expect(policy.requiredFinalItems.map((r) => r.label)).toEqual(['Fictional service held', 'Fictional committal confirmed']);
    expect(toggleRequiredFinalItem(policy, held).requiredFinalItems.map((r) => r.label)).toEqual(['Fictional committal confirmed']);
    expect(setRemainsReturnRequired(policy, true)).toMatchObject({ kind: 'remains_return', requiresRemainsReturn: true });
    expect(setRemainsReturnRequired(policy, false)).toMatchObject({ kind: 'final_items', requiresRemainsReturn: false });
    expect(setManualCompletion(policy, { allowed: true }).manualCompletion).toEqual({ allowed: true, permission: 'case.delete' });
    expect(setManualCompletion(policy, { allowed: false, permission: 'case.update' }).manualCompletion).toEqual({ allowed: false });
  });

  it('detects a required item that was moved, renamed or removed — and toggling the new item there replaces it', () => {
    const committal = completionItemOptions(stages)[1].ref;
    const policy = finalItemsCompletionPolicy({ requiredFinalItems: [committal] });
    expect(staleRequiredFinalItems(policy, stages)).toEqual([]);
    const renamed = updateChecklistItem(stages, 4, 0, { label: 'Fictional burial confirmed' });
    expect(staleRequiredFinalItems(policy, renamed)).toEqual([committal]);
    expect(staleRequiredFinalItems(policy, removeChecklistItem(stages, 4, 0))).toEqual([committal]);
    const replaced = toggleRequiredFinalItem(policy, completionItemOptions(renamed)[1].ref);
    expect(replaced.requiredFinalItems.map((r) => r.label)).toEqual(['Fictional burial confirmed']);
  });
});

describe('validation', () => {
  const stages = burialStages();
  const committal = completionItemOptions(stages)[1].ref;

  it('draft: coherent shape only — an undefined burial policy saves', () => {
    expect(validateCompletionPolicy(finalItemsCompletionPolicy(), stages, 'draft')).toEqual([]);
    expect(codes(validateCompletionPolicy({ ...finalItemsCompletionPolicy(), requiresRemainsReturn: true }, stages, 'draft'))).toEqual(['completion_kind_mismatch']);
    expect(codes(validateCompletionPolicy({ ...finalItemsCompletionPolicy(), archiveEligibility: 'never' as never }, stages, 'draft'))).toEqual(['completion_archive_invalid']);
  });

  it('approval: a final-items policy needs its items; stale and duplicate items are refused', () => {
    expect(codes(validateCompletionPolicy(finalItemsCompletionPolicy(), stages, 'approval'))).toEqual(['completion_items_undefined']);
    expect(validateCompletionPolicy(finalItemsCompletionPolicy({ requiredFinalItems: [committal] }), stages, 'approval')).toEqual([]);
    expect(validateCompletionPolicy(remainsReturnCompletionPolicy(), stages, 'approval')).toEqual([]);
    const stale = finalItemsCompletionPolicy({ requiredFinalItems: [{ ...committal, label: 'Something else' }] });
    expect(codes(validateCompletionPolicy(stale, stages, 'approval'))).toEqual(['completion_item_stale']);
    const twice = finalItemsCompletionPolicy({ requiredFinalItems: [committal, committal] });
    expect(codes(validateCompletionPolicy(twice, stages, 'approval'))).toEqual(['completion_item_duplicate']);
  });

  it('templateValidation requires a policy when asked, and runs it at both levels', () => {
    expect(codes(validateWorkflowStages(stages, 'approval', { requireCompletionPolicy: true }))).toEqual(['completion_policy_missing']);
    expect(codes(validateWorkflowStages(stages, 'approval', { completionPolicy: finalItemsCompletionPolicy() }))).toEqual(['completion_items_undefined']);
    expect(codes(validateWorkflowStages(stages, 'draft', { completionPolicy: { ...remainsReturnCompletionPolicy(), kind: 'final_items' } }))).toEqual(['completion_kind_mismatch']);
    // Callers that predate policies see no change.
    expect(validateWorkflowStages(stages, 'approval')).toEqual([]);
  });

  it('parses an untrusted body: normalizes, rejects malformed', () => {
    const { policy } = parseCompletionPolicy({ ...finalItemsCompletionPolicy({ requiredFinalItems: [committal] }), manualCompletion: { allowed: true }, extra: 'ignored' });
    expect(policy).toEqual({ ...finalItemsCompletionPolicy({ requiredFinalItems: [committal] }), manualCompletion: { allowed: true, permission: 'case.delete' } });
    expect(parseCompletionPolicy(null).policy).toBeNull();
    expect(parseCompletionPolicy({ ...remainsReturnCompletionPolicy(), manualCompletion: { allowed: true, permission: 'workflow.publish' } }).errors[0]).toMatch(/existing case permission/);
    expect(parseCompletionPolicy({ ...remainsReturnCompletionPolicy(), requiredFinalItems: [{ displayStage: 'x' }] }).policy).toBeNull();
  });

  it('describes a policy for the preview', () => {
    expect(describeCompletionPolicy(finalItemsCompletionPolicy())[1]).toMatch(/not defined yet/);
    expect(describeCompletionPolicy(remainsReturnCompletionPolicy())[0]).toMatch(/return of cremated remains/);
  });
});

describe('unfinished-workflow protection', () => {
  it('recognizes a placeholder stage by name — refused at approval even with an item added', () => {
    expect(isPlaceholderStageLabel('Graveside burial — steps to be defined')).toBe(true);
    expect(isPlaceholderStageLabel('Graveside Service')).toBe(false);
    const graveside = byCode(gus, 'GRAVESIDE_BURIAL_SERVICE_ONLY').versions[0].stages;
    const placeholder = graveside.find((s) => isPlaceholderStageLabel(s.label))!;
    const withItem = addChecklistItem(graveside, placeholder.displayStage, 'Example step');
    expect(codes(validateWorkflowStages(withItem, 'approval'))).toEqual(['placeholder_stage']);
    expect(validateWorkflowStages(updateStage(withItem, placeholder.displayStage, { label: 'Example stage' }), 'approval')).toEqual([]);
  });

  /** A hand-made copy of Direct Cremation's current version (not built from
      the shared foundation), marked as copied from it when `marked`. */
  function handMadeCopy(marked: boolean) {
    const direct = byCode(gus, 'DIRECT_CREMATION');
    const latest = direct.versions[direct.versions.length - 1];
    return { ...structuredClone(latest), composition: undefined, derivedFrom: marked ? { templateId: direct.id, version: latest.version } : undefined };
  }

  it('finds an unmodified copy — and nothing once a copy is made its own', () => {
    const version = handMadeCopy(true);
    expect(findUnmodifiedCopySource(version, gus, 'workflow-template-fictional-copy')?.name).toBe('Direct Cremation');
    const problems = validateWorkflowStages(version.stages, 'approval', {
      organizationTemplates: gus,
      templateId: 'workflow-template-fictional-copy',
      checkUnmodifiedCopy: true,
      derivedFrom: version.derivedFrom,
      completionPolicy: version.completionPolicy,
    });
    expect(problems.map((p) => p.message)).toEqual([
      'This workflow is still an unmodified copy of Direct Cremation; define the service-specific steps before approval.',
    ]);
    const owned = addChecklistItem(version.stages, 5, 'Example service-specific step');
    expect(findUnmodifiedCopySource({ ...version, stages: owned }, gus, 'workflow-template-fictional-copy')).toBeNull();
    // A changed completion requirement also makes it its own; a changed NOTE does not.
    expect(findUnmodifiedCopySource({ ...version, completionPolicy: { ...version.completionPolicy!, archiveEligibility: 'manual' } }, gus)).toBeNull();
    expect(findUnmodifiedCopySource({ ...version, completionPolicy: { ...version.completionPolicy!, note: 'Edited note' } }, gus)?.name).toBe('Direct Cremation');
  });

  it('services composed from the shared foundation may match each other — that is the design, not a copy (2026-11)', () => {
    for (const code of ['CREMATION_WITH_FINAL_GOODBYE', 'CREMATION_WITH_VIEWING']) {
      const template = byCode(gus, code);
      expect(findUnmodifiedCopySource(template.versions[0], gus, template.id)).toBeNull();
    }
  });

  it('without a derivedFrom marker, an identical APPROVED workflow elsewhere still gives it away', () => {
    expect(findUnmodifiedCopySource(handMadeCopy(false), gus, 'workflow-template-fictional-copy')?.name).toBe('Direct Cremation');
    // Editing Direct Cremation itself is never "a copy of" its own versions.
    const direct = byCode(gus, 'DIRECT_CREMATION');
    expect(findUnmodifiedCopySource(direct.versions[direct.versions.length - 1], gus, direct.id)).toBeNull();
  });
});
