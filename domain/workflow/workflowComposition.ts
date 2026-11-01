import type { ChecklistItemTemplate, StageTemplate, WorkflowComposition } from '../../types/workflowTemplate';

/**
 * Workflow composition (2026-11): a shared base workflow (such as the
 * cremation foundation, domain/workflow/cremationFoundation.ts) plus
 * service extensions that ADD steps to it.
 *
 * Rules that keep the base intact and every existing case readable:
 * - An extension can only add: checklist items to an existing stage, or a
 *   whole new stage before an existing one. It can never remove, rename or
 *   reorder a base step.
 * - Added items take indices above the stage's existing ones, so a base
 *   item keeps its "{displayStage}:{index}" storage key.
 * - Added stages shift the stages after them; shared logic that must find a
 *   base step therefore looks it up by stepId (domain/workflow/workflowSteps.ts),
 *   never by position.
 * - Every added stage and item carries its own stable stageKey / stepId.
 * - The result is flattened into an ordinary template version, so the
 *   checklist engine and every case snapshot stay exactly as they are.
 */

export type ExtensionItem = {
  stepId: string;
  label: string;
  /** A typed value rather than a plain confirmation. Default false. */
  hasField?: boolean;
};

export type WorkflowExtensionAddition =
  | { kind: 'items'; stageKey: string; items: ExtensionItem[] }
  | {
      kind: 'stage';
      beforeStageKey: string;
      stage: { stageKey: string; label: string; slaTargetDays: number | null; isAttentionStage?: boolean; items: ExtensionItem[] };
    };

export type WorkflowExtension = {
  key: string;
  version: number;
  /** Shown to staff, e.g. "Viewing". */
  label: string;
  /** True while the funeral home has not yet defined this service's own
      steps — the service then runs the base workflow unchanged. */
  stepsToBeDefined: boolean;
  additions: WorkflowExtensionAddition[];
};

export class WorkflowCompositionError extends Error {}

function toItem(item: ExtensionItem, index: number): ChecklistItemTemplate {
  return { index, label: item.label, hasField: item.hasField ?? false, isPasswordField: false, externalFormIntegrationId: null, stepId: item.stepId };
}

/** Flattens a base workflow plus extensions into ordinary template stages. */
export function composeWorkflowStages(base: readonly StageTemplate[], extensions: readonly WorkflowExtension[]): StageTemplate[] {
  let stages: StageTemplate[] = structuredClone(base as StageTemplate[]);
  const seenSteps = new Set(stages.flatMap((s) => s.checklist.items.map((i) => i.stepId).filter((id): id is string => Boolean(id))));
  const seenStages = new Set(stages.map((s) => s.stageKey).filter((k): k is string => Boolean(k)));
  const claim = (stepId: string) => {
    if (seenSteps.has(stepId)) throw new WorkflowCompositionError(`Step "${stepId}" is defined twice.`);
    seenSteps.add(stepId);
  };

  for (const extension of extensions) {
    for (const addition of extension.additions) {
      if (addition.kind === 'items') {
        // Raw stages that share a display stage share their items, so every
        // stage with this display stage gets the same additions.
        const target = stages.find((s) => s.stageKey === addition.stageKey);
        if (!target) throw new WorkflowCompositionError(`${extension.label}: no stage "${addition.stageKey}" to add steps to.`);
        addition.items.forEach((item) => claim(item.stepId));
        stages = stages.map((stage) => {
          if (stage.displayStage !== target.displayStage) return stage;
          const next = Math.max(-1, ...stage.checklist.items.map((i) => i.index)) + 1;
          return { ...stage, checklist: { ...stage.checklist, items: [...stage.checklist.items, ...addition.items.map((item, k) => toItem(item, next + k))] } };
        });
      } else {
        const at = stages.findIndex((s) => s.stageKey === addition.beforeStageKey);
        if (at === -1) throw new WorkflowCompositionError(`${extension.label}: no stage "${addition.beforeStageKey}" to insert before.`);
        if (seenStages.has(addition.stage.stageKey)) throw new WorkflowCompositionError(`Stage "${addition.stage.stageKey}" is defined twice.`);
        seenStages.add(addition.stage.stageKey);
        addition.stage.items.forEach((item) => claim(item.stepId));
        const { rawStage, displayStage } = stages[at];
        const inserted: StageTemplate = {
          rawStage,
          displayStage,
          label: addition.stage.label,
          isAttentionStage: addition.stage.isAttentionStage ?? false,
          slaTargetDays: addition.stage.slaTargetDays,
          checklist: { items: addition.stage.items.map((item, k) => toItem(item, k)) },
          stageKey: addition.stage.stageKey,
        };
        stages = [
          ...stages.slice(0, at),
          inserted,
          ...stages.slice(at).map((s) => ({ ...s, rawStage: s.rawStage + 1, displayStage: s.displayStage + 1 })),
        ];
      }
    }
  }
  return stages;
}

export function compositionOf(baseKey: string, baseVersion: number, extensions: readonly WorkflowExtension[]): WorkflowComposition {
  return { base: { key: baseKey, version: baseVersion }, extensions: extensions.map((e) => ({ key: e.key, version: e.version })) };
}
