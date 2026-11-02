import type { Case } from '../../types/case';
import type { CaseWorkflowSnapshot, WorkflowTemplate } from '../../types/workflowTemplate';
import { STAGES, isBottleneckStage, rawStagesForDisplayStage } from '../cases/stages';
import { getSlaTargetDays } from '../cases/sla';
import { presentedStages } from '../organization/workflowStagePresentation';
import { isWorkflowByServiceType } from './selectWorkflowTemplate';
import { isApprovedVersion } from './snapshot';
import { displayStagesInOrder, findStageByRawStage, lastDisplayStage } from './resolveStages';

/**
 * Service-specific workflows (2026-10). The organization-wide stage list
 * the shared surfaces (Dashboard "Cases by stage", tab counts, the Cases
 * list stage filter, Reports) group cases by.
 *
 * Organizations without `features.workflowByServiceType` keep the single
 * global list from domain/cases/stages.ts (through the Manors presentation
 * overlay) — `kind: 'global'`, exactly what those surfaces already used;
 * every caller keeps running its existing code for them, and the
 * equivalence is pinned by organizationStages.test.ts.
 *
 * For an organization with several service workflows, cases on different
 * templates sit at different stages that may share a name. The list is the
 * ordered union of the display-stage labels of every template's
 * APPROVED versions — the latest defining the order, superseded ones still
 * listed for the cases frozen on them (drafts are never used by a case, so
 * never listed),
 * deduplicated by label, and each label remembers exactly which
 * (template, raw stages) it covers — so a stage filter or count is always
 * "cases on template A at raw stage n, or on template B at raw stage m",
 * never a raw-stage number that means different things in different
 * templates.
 *
 * Ordering: by display position, with each template's terminal stage
 * ("Completed") sorted after every non-terminal stage; ties keep the
 * caller's template order (enabled templates first). The first template
 * — Direct Cremation for Gus — therefore defines the base order.
 */

export type OrganizationStageMember = {
  workflowTemplateId: string;
  rawStages: number[];
  /** Set only when approved versions of the same template give one of
      these raw stages DIFFERENT names (a later version renamed or
      restructured a stage): the member then covers just the versions that
      use this label, so a case created under a superseded version still
      counts under its own snapshot's label — never under the newer
      version's name for that raw stage, and never under both. Absent =
      every version of the template (the usual case, and every case today). */
  workflowTemplateVersions?: number[];
};

export type OrganizationStage = {
  label: string;
  /** Rendered with the "needs attention" color when any member template
      marks the stage as its attention stage. */
  isAttentionStage: boolean;
  /** A terminal ("Completed") stage of at least one template. */
  isTerminal: boolean;
  /** The longest SLA target among the stages this label covers (the same
      "max, never sum" rule Reports applies to Manors' combined stage). */
  slaTargetDays: number | null;
  /** Empty for `kind: 'global'` (the raw stages apply to every case). */
  members: OrganizationStageMember[];
  /** `kind: 'global'` only: the raw stages this label covers. */
  globalRawStages: number[];
};

export type OrganizationStageModel = { kind: 'global' | 'per_template'; stages: OrganizationStage[] };

function maxTarget(targets: Array<number | null | undefined>): number | null {
  const real = targets.filter((t): t is number => t != null);
  return real.length === 0 ? null : Math.max(...real);
}

function globalModel(organizationId: string): OrganizationStageModel {
  return {
    kind: 'global',
    stages: presentedStages(organizationId, STAGES).map((stage) => ({
      label: stage.label,
      isAttentionStage: stage.canonicalDisplayStages.some((ds) => isBottleneckStage(ds)),
      isTerminal: stage.canonicalDisplayStages.includes(STAGES.length - 1),
      slaTargetDays: maxTarget(stage.canonicalDisplayStages.map((ds) => getSlaTargetDays(ds))),
      members: [],
      globalRawStages: stage.canonicalDisplayStages.flatMap((ds) => rawStagesForDisplayStage(ds)),
    })),
  };
}

export function resolveOrganizationStages(
  organizationId: string,
  templates: readonly WorkflowTemplate[],
): OrganizationStageModel {
  if (!isWorkflowByServiceType(organizationId)) return globalModel(organizationId);

  const ordered = [...templates.filter((t) => t.organizationId === organizationId)].sort(
    (a, b) => Number(b.isEnabled) - Number(a.isEnabled),
  );

  type Entry = OrganizationStage & { position: number; order: number };
  const byLabel = new Map<string, Entry>();
  let order = 0;

  // Every APPROVED version counts, not only the latest: a case keeps the
  // frozen snapshot of the version it was created under, so a superseded
  // version's cases must still land under their own stage names (and a
  // raw stage only that version has must not fall out of every count).
  // Latest versions are visited first, all templates before any older
  // version, so the base order is exactly the latest versions' order.
  type Visit = { template: WorkflowTemplate; version: WorkflowTemplate['versions'][number] };
  const approvedByTemplate = ordered.map((template) => ({
    template,
    approved: template.versions.filter(isApprovedVersion).reverse(),
  }));
  const visits: Visit[] = [
    ...approvedByTemplate.flatMap(({ template, approved }) => (approved.length > 0 ? [{ template, version: approved[0] }] : [])),
    ...approvedByTemplate.flatMap(({ template, approved }) => approved.slice(1).map((version) => ({ template, version }))),
  ];

  const pseudoSnapshotOf = ({ template, version }: Visit) => ({
    workflowTemplateId: template.id,
    workflowTemplateVersion: version.version,
    stages: version.stages,
    intake: version.intake,
  });

  // Per template: the set of names each raw stage carries across its
  // approved versions. One name everywhere (the normal case) means the
  // raw stage needs no version qualifier.
  const labelsByTemplateRaw = new Map<string, Map<number, Set<string>>>();
  for (const visit of visits) {
    const byRaw = labelsByTemplateRaw.get(visit.template.id) ?? new Map<number, Set<string>>();
    labelsByTemplateRaw.set(visit.template.id, byRaw);
    for (const stage of displayStagesInOrder(pseudoSnapshotOf(visit))) {
      for (const raw of visit.version.stages.filter((s) => s.displayStage === stage.displayStage).map((s) => s.rawStage)) {
        const labels = byRaw.get(raw) ?? new Set<string>();
        labels.add(stage.label);
        byRaw.set(raw, labels);
      }
    }
  }

  const addMember = (entry: Entry, templateId: string, rawStages: number[], version: number | null) => {
    if (rawStages.length === 0) return;
    const member = entry.members.find(
      (m) =>
        m.workflowTemplateId === templateId &&
        (version === null
          ? m.workflowTemplateVersions === undefined
          : m.workflowTemplateVersions !== undefined && m.rawStages.join() === rawStages.join()),
    );
    if (!member) {
      entry.members.push(version === null ? { workflowTemplateId: templateId, rawStages } : { workflowTemplateId: templateId, rawStages, workflowTemplateVersions: [version] });
    } else if (version === null) {
      member.rawStages = [...new Set([...member.rawStages, ...rawStages])].sort((a, b) => a - b);
    } else if (!member.workflowTemplateVersions!.includes(version)) {
      member.workflowTemplateVersions = [...member.workflowTemplateVersions!, version].sort((a, b) => a - b);
    }
  };

  for (const visit of visits) {
    const { template, version } = visit;
    const pseudoSnapshot = pseudoSnapshotOf(visit);
    const terminalDisplayStage = lastDisplayStage(pseudoSnapshot);
    const byRaw = labelsByTemplateRaw.get(template.id)!;

    for (const stage of displayStagesInOrder(pseudoSnapshot)) {
      const rawStages = version.stages.filter((s) => s.displayStage === stage.displayStage).map((s) => s.rawStage).sort((a, b) => a - b);
      const unambiguous = rawStages.filter((raw) => byRaw.get(raw)!.size === 1);
      const versionSpecific = rawStages.filter((raw) => byRaw.get(raw)!.size > 1);
      const isTerminal = stage.displayStage === terminalDisplayStage;
      let entry = byLabel.get(stage.label);
      if (entry) {
        entry.isAttentionStage ||= Boolean(stage.isAttentionStage);
        entry.isTerminal ||= isTerminal;
        entry.slaTargetDays = maxTarget([entry.slaTargetDays, stage.slaTargetDays]);
      } else {
        entry = {
          label: stage.label,
          isAttentionStage: Boolean(stage.isAttentionStage),
          isTerminal,
          slaTargetDays: stage.slaTargetDays,
          members: [],
          globalRawStages: [],
          position: stage.displayStage,
          order: order++,
        };
        byLabel.set(stage.label, entry);
      }
      addMember(entry, template.id, unambiguous, null);
      addMember(entry, template.id, versionSpecific, version.version);
    }
  }

  const stages = [...byLabel.values()]
    .sort((a, b) => Number(a.isTerminal) - Number(b.isTerminal) || a.position - b.position || a.order - b.order)
    .map((entry): OrganizationStage => ({
      label: entry.label,
      isAttentionStage: entry.isAttentionStage,
      isTerminal: entry.isTerminal,
      slaTargetDays: entry.slaTargetDays,
      members: entry.members,
      globalRawStages: entry.globalRawStages,
    }));
  return { kind: 'per_template', stages };
}

export function organizationStageLabels(model: OrganizationStageModel): string[] {
  return model.stages.map((stage) => stage.label);
}

export function findOrganizationStage(model: OrganizationStageModel, label: string): OrganizationStage | null {
  return model.stages.find((stage) => stage.label === label) ?? null;
}

/** Whether a case belongs to an organization stage — matched on the case's
    own (workflowTemplateId, rawStage), the same pair the Wix filter uses. */
export function caseIsInOrganizationStage(
  stage: OrganizationStage,
  case_: Pick<Case, 'workflowTemplateId' | 'rawStage'> & Partial<Pick<Case, 'workflowTemplateVersion'>>,
): boolean {
  if (stage.members.length === 0) return stage.globalRawStages.includes(case_.rawStage);
  return stage.members.some(
    (m) =>
      m.workflowTemplateId === case_.workflowTemplateId &&
      m.rawStages.includes(case_.rawStage) &&
      (m.workflowTemplateVersions === undefined ||
        (case_.workflowTemplateVersion !== undefined && m.workflowTemplateVersions.includes(case_.workflowTemplateVersion))),
  );
}

/** The Wix `cases` filter fragment for one per-template stage: an `$or` of
    `{ workflowTemplateId, currentStage: { $in } }` — `currentStage` is the
    collection's field for Case.rawStage (lib/wixCaseMapper.ts). A
    version-specific member (see OrganizationStageMember) adds
    `workflowTemplateVersion: { $in }`, the case's own top-level column. */
export function wixFilterForOrganizationStage(stage: OrganizationStage): Record<string, unknown> {
  return {
    $or: stage.members.map((m) =>
      m.workflowTemplateVersions === undefined
        ? { workflowTemplateId: m.workflowTemplateId, currentStage: { $in: m.rawStages } }
        : { workflowTemplateId: m.workflowTemplateId, workflowTemplateVersion: { $in: m.workflowTemplateVersions }, currentStage: { $in: m.rawStages } },
    ),
  };
}

/**
 * A case's stage NAME from its own frozen snapshot — the authority for
 * per-case labels (activity history, reports, exports) for organizations
 * with service workflows, whose cases do not share one global stage list.
 * Null when the snapshot has no stage at that raw stage.
 */
export function snapshotStageLabel(snapshot: CaseWorkflowSnapshot | null | undefined, rawStage: number): string | null {
  if (!snapshot) return null;
  return findStageByRawStage(snapshot, rawStage)?.label ?? null;
}

/** Whether the case sits on its own workflow's terminal stage. */
export function isCaseOnTerminalStage(case_: Pick<Case, 'workflowSnapshot' | 'rawStage'>): boolean {
  const snapshot = case_.workflowSnapshot;
  if (!snapshot || snapshot.stages.length === 0) return false;
  const stage = findStageByRawStage(snapshot, case_.rawStage);
  return stage !== undefined && stage.displayStage === lastDisplayStage(snapshot);
}
