import { useMemo } from 'react';
import type { StageTemplate, WorkflowComposition, WorkflowCompletionPolicy, WorkflowTemplate, WorkflowVersionSource } from '@/types/workflowTemplate';
import { serviceTypeItems } from '@/domain/pricing/calculateOrder';
import { isWorkflowByServiceType } from '@/domain/workflow/selectWorkflowTemplate';
import { validateWorkflowStages, type WorkflowValidationProblem } from '@/domain/workflow/templateValidation';
import { useServiceCatalog } from './useServiceCatalog';
import { useWorkflowTemplates } from './useWorkflowTemplates';
import { useOrganization } from './useOrganization';

/**
 * Workflow template editor (2026-10). The 'approval'-level problems of one
 * version's content (or the editor's unsaved draft) — the same pure rules
 * the approve route enforces server-side (domain/workflow/templateValidation.ts),
 * so the editor can explain BEFORE approval why a version cannot go live.
 * Only rendered for organizations whose versions require approval; the
 * catalog/templates reads it needs are the ones Settings already makes.
 * While either is still loading, the service checks that depend on it are
 * simply skipped (the server stays authoritative).
 *
 * Service-specific completion (2026-10): `completion` carries the
 * version's (or draft's) completion policy and copy source, so the same
 * completion, placeholder and unmodified-copy rules the route applies are
 * shown here too.
 */
export function useWorkflowApprovalProblems(
  template: WorkflowTemplate,
  stages: readonly StageTemplate[],
  serviceTypeCodes: readonly string[] | undefined,
  completion: { completionPolicy?: WorkflowCompletionPolicy | null; derivedFrom?: WorkflowVersionSource | null; composition?: WorkflowComposition | null } = {},
): WorkflowValidationProblem[] {
  const { organizationId } = useOrganization();
  const byServiceType = isWorkflowByServiceType(organizationId);
  const { data: catalog } = useServiceCatalog();
  const { data: templates } = useWorkflowTemplates({ enabled: byServiceType });

  return useMemo(() => {
    const services = catalog ? serviceTypeItems(catalog) : null;
    return validateWorkflowStages(stages, 'approval', {
      serviceTypeCodes: byServiceType ? (serviceTypeCodes ?? template.serviceTypeCodes ?? []) : undefined,
      activeServiceTypeCodes: byServiceType && services ? services.map((item) => item.serviceCode) : undefined,
      requireServiceAssignment: byServiceType,
      organizationTemplates: byServiceType && Array.isArray(templates) ? templates : undefined,
      templateId: template.id,
      templateIsEnabled: template.isEnabled,
      serviceDisplayName: (code) => services?.find((item) => item.serviceCode === code)?.displayName,
      completionPolicy: completion.completionPolicy ?? null,
      requireCompletionPolicy: true,
      checkUnmodifiedCopy: true,
      derivedFrom: completion.derivedFrom ?? null,
      composition: completion.composition ?? null,
    });
  }, [stages, serviceTypeCodes, template, byServiceType, catalog, templates, completion.completionPolicy, completion.derivedFrom, completion.composition]);
}
