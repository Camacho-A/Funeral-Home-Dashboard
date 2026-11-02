import type { DataAdapterMode } from '../lib/env';
import type { WorkflowTemplate } from '../types/workflowTemplate';
import { fetchWixWorkflowTemplates } from '../lib/wixWorkflowTemplateMapper';
import { workflowTemplateFixtures } from './__mocks__/workflowTemplates';

/**
 * Service-specific workflows (2026-10). Server-side read of one
 * organization's workflow templates (all of them, enabled or not, each
 * with its versions) — the same data GET /api/workflow-templates returns,
 * for server code that needs the organization's stage model
 * (domain/workflow/organizationStages.ts) or a template to change a case
 * onto. Always scoped to the given organization.
 */
export async function listOrganizationWorkflowTemplates(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<WorkflowTemplate[]> {
  if (dataAdapterMode === 'mock') {
    return workflowTemplateFixtures.filter((t) => t.organizationId === organizationId);
  }
  return fetchWixWorkflowTemplates(organizationId);
}
