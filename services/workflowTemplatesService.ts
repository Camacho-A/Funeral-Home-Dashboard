import type { OrganizationContext } from '../types/organization';
import type { WorkflowTemplate } from '../types/workflowTemplate';
import { workflowTemplateFixtures } from './__mocks__/workflowTemplates';

/**
 * Same shape as every other mock service — organization-scoped, filtered by
 * context.organizationId for real (a call with a mismatched organizationId
 * returns empty), per docs/adr/ADR-002-multi-tenant-architecture.md.
 */

export async function list(context: OrganizationContext): Promise<WorkflowTemplate[]> {
  return workflowTemplateFixtures.filter((t) => t.organizationId === context.organizationId);
}

/**
 * The "workflow selection logic" the New Case flow needs: which enabled
 * template supports the given case type. Returns null (not an error) when
 * none match — the caller decides how to handle that (today, NewCaseModal
 * only ever creates 'cremation' cases for Managed Cremations, which always
 * resolves).
 */
export async function getEnabledForCaseType(
  context: OrganizationContext,
  caseType: string,
): Promise<WorkflowTemplate | null> {
  const templates = await list(context);
  return templates.find((t) => t.isEnabled && t.caseTypes.includes(caseType)) ?? null;
}

export const workflowTemplatesService = { list, getEnabledForCaseType };
