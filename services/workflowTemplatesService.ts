import type { OrganizationContext } from '../types/organization';
import type { StageTemplate, WorkflowTemplate } from '../types/workflowTemplate';

/**
 * Phase 15B (Wix Workflow Template Read Integration). Like
 * services/organizationsService.ts (Phase 15A), this never branches on
 * DATA_ADAPTER itself — it always calls the Route Handlers under
 * app/api/workflow-templates/. This is called from Client Component hooks
 * (useWorkflowTemplates), and DATA_ADAPTER isn't visible in the browser
 * bundle, so only the Route Handler (genuinely server-side) can correctly
 * decide mock vs. Wix. list()/getEnabledForCaseType()'s signatures and
 * behavior are unchanged from before this phase; get() is new.
 */

export async function list(context: OrganizationContext): Promise<WorkflowTemplate[]> {
  const response = await fetch(`/api/workflow-templates?organizationId=${encodeURIComponent(context.organizationId)}`);
  if (!response.ok) {
    throw new Error('Failed to load workflow templates.');
  }
  const body = (await response.json()) as { workflowTemplates: WorkflowTemplate[] };
  return body.workflowTemplates;
}

/**
 * Retrieves one workflow template by its Beacon domain id, scoped by
 * organizationId — never trusts templateId alone as proof it belongs to
 * this organization.
 */
export async function get(context: OrganizationContext, templateId: string): Promise<WorkflowTemplate | null> {
  const response = await fetch(
    `/api/workflow-templates/${encodeURIComponent(templateId)}?organizationId=${encodeURIComponent(context.organizationId)}`,
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error('Failed to load workflow template.');
  }
  const body = (await response.json()) as { workflowTemplate: WorkflowTemplate | null };
  return body.workflowTemplate;
}

/**
 * The "workflow selection logic" the New Case flow needs: which enabled
 * template supports the given case type. Returns null (not an error) when
 * none match — the caller decides how to handle that (today, NewCaseModal
 * only ever creates 'cremation' cases for Manor's Cremation, which always
 * resolves).
 */
export async function getEnabledForCaseType(
  context: OrganizationContext,
  caseType: string,
): Promise<WorkflowTemplate | null> {
  const templates = await list(context);
  return templates.find((t) => t.isEnabled && t.caseTypes.includes(caseType)) ?? null;
}

/**
 * Phase 18 (Workflow Management). Submits an admin's edited `stages` array
 * as a brand-new WorkflowTemplateVersion — the Route Handler (never this
 * function) decides mock-vs-Wix, computes the next version number, and
 * validates the payload server-side; this is purely "call the endpoint,
 * parse the response," same division of responsibility as list()/get().
 */
export async function createVersion(
  context: OrganizationContext,
  templateId: string,
  stages: StageTemplate[],
): Promise<WorkflowTemplate> {
  const response = await fetch(`/api/workflow-templates/${encodeURIComponent(templateId)}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: context.organizationId, stages }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Failed to save workflow changes.');
  }
  const body = (await response.json()) as { workflowTemplate: WorkflowTemplate };
  return body.workflowTemplate;
}

export const workflowTemplatesService = { list, get, getEnabledForCaseType, createVersion };
