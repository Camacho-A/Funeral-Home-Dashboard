import { useMemo } from 'react';
import { STAGES } from '@/domain/cases/stages';
import { presentedStages } from '@/domain/organization/workflowStagePresentation';
import { usesTemplateStages } from '@/domain/workflow/selectWorkflowTemplate';
import { resolveOrganizationStages } from '@/domain/workflow/organizationStages';
import type { StageBarRow } from '@/components/dashboard/CasesByStagePanel';
import { useCaseCounts } from './useCaseCounts';
import { useOrganization } from './useOrganization';
import { useWorkflowTemplates } from './useWorkflowTemplates';

/**
 * The Dashboard's "Cases by stage" rows for the CURRENT organization
 * (extracted unchanged from app/(portal)/dashboard/page.tsx so the unified
 * portal's combined Dashboard computes each organization's rows with that
 * organization's OWN stage model — never a merged one).
 *
 * Manors intake-stage combination (2026-10): rows are the user-facing
 * stages; a presented stage's count is the SUM of the canonical per-stage
 * counts it covers (disjoint raw-stage sets, so nothing is double-counted).
 * Service-specific workflows (2026-10): an organization whose cases run on
 * several templates gets one row per organization stage (the ordered
 * union across its approved workflows), counted server-side per
 * (template, raw stage); the bottleneck flag comes from the templates.
 */
export function useStageBreakdownRows(): { rows: StageBarRow[]; total: number | null } {
  const { organizationId } = useOrganization();
  const { data: countsData } = useCaseCounts({ searchQuery: '' });
  const stagesByTemplate = usesTemplateStages(organizationId);
  const { data: workflowTemplates } = useWorkflowTemplates({ enabled: stagesByTemplate });
  const rows = useMemo(() => {
    if (stagesByTemplate) {
      const model = resolveOrganizationStages(organizationId, workflowTemplates ?? []);
      const counts = model.stages.map((stage) => countsData?.byStage[stage.label] ?? null);
      const maxCount = Math.max(1, ...counts.map((c) => c ?? 0));
      return model.stages.map((stage, index) => ({
        label: stage.label,
        count: counts[index],
        pct: counts[index] === null ? 0 : Math.round((counts[index]! / maxCount) * 100),
        displayStage: index,
        isAttentionStage: stage.isAttentionStage,
      }));
    }
    const presented = presentedStages(organizationId, STAGES);
    const counts = presented.map((stage) => {
      const parts = stage.canonicalDisplayStages.map((ds) => countsData?.byStage[STAGES[ds]] ?? null);
      return parts.every((part) => part === null) ? null : parts.reduce((sum, part) => (sum ?? 0) + (part ?? 0), 0 as number | null);
    });
    const maxCount = Math.max(1, ...counts.map((c) => c ?? 0));
    return presented.map((stage, index) => ({
      label: stage.label,
      count: counts[index],
      pct: counts[index] === null ? 0 : Math.round((counts[index]! / maxCount) * 100),
      displayStage: stage.canonicalDisplayStages[0],
    }));
  }, [countsData, organizationId, stagesByTemplate, workflowTemplates]);
  const total = countsData?.total ?? null;
  return useMemo(() => ({ rows, total }), [rows, total]);
}
