import type { WorkflowTemplate, WorkflowTemplateVersion } from '../../types/workflowTemplate';
import { getRegisteredOrganizationProfile } from '../organization/organizationProfiles';
import { latestApprovedVersion, latestTemplateVersion } from './snapshot';

/**
 * Service-specific workflows (2026-10). The ONE rule for "which workflow
 * template (and which version of it) does a new case get" — used by every
 * case-creation path (POST /api/cases, services/casesService.ts's mock
 * create, hooks/useCreateCase.ts, NewCaseModal's preview, and the import
 * paths that post to POST /api/cases), so they can never disagree.
 *
 * - An organization WITHOUT `features.workflowByServiceType` (Manors,
 *   evergreen, every platform default) gets exactly what it always got:
 *   the first enabled template and its latest version. `serviceTypeCode`
 *   is ignored entirely.
 *
 * - An organization WITH it (Gus) must name a service type; the case gets
 *   the single enabled template whose `serviceTypeCodes` includes it, at
 *   its latest APPROVED version. No template, a draft-only template, or
 *   two templates claiming the same service are each refused with a
 *   message staff can act on — never a guess, never a fallback to some
 *   other service's workflow.
 */

export function isWorkflowByServiceType(organizationId: string | null | undefined): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.workflowByServiceType;
}

export function isWorkflowApprovalRequired(organizationId: string | null | undefined): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.workflowApprovalRequired;
}

export type WorkflowSelectionRefusalReason =
  | 'no_enabled_template'
  | 'service_type_required'
  | 'unknown_service_type'
  | 'no_template_for_service'
  | 'ambiguous_service_template'
  | 'not_approved';

export type WorkflowSelectionResult =
  | { ok: true; template: WorkflowTemplate; version: WorkflowTemplateVersion; serviceTypeCode: string | null }
  | { ok: false; reason: WorkflowSelectionRefusalReason; message: string };

export type WorkflowSelectionOptions = {
  /** The organization's ACTIVE `service_type` catalog codes. When given,
      a code outside it is refused (server-side validation). Omitted = the
      caller has no catalog to check against (the client preview). */
  activeServiceTypeCodes?: readonly string[];
  /** Staff-facing service name for messages; falls back to the code. */
  serviceDisplayName?: (serviceTypeCode: string) => string | null | undefined;
};

/** Staff-facing refusal copy, exported so the UI and tests share it. */
export function notApprovedWorkflowMessage(serviceName: string): string {
  return `The workflow for ${serviceName} has not been approved yet. An administrator must review and approve it in Settings › Workflow Templates before cases can use it.`;
}

export function selectWorkflowTemplate(
  templates: readonly WorkflowTemplate[],
  organizationId: string,
  serviceTypeCode: string | null | undefined,
  options: WorkflowSelectionOptions = {},
): WorkflowSelectionResult {
  if (!isWorkflowByServiceType(organizationId)) {
    const template = templates.find((t) => t.isEnabled);
    if (!template) {
      return { ok: false, reason: 'no_enabled_template', message: 'No enabled workflow template found for this organization.' };
    }
    return { ok: true, template, version: latestTemplateVersion(template), serviceTypeCode: null };
  }

  const code = typeof serviceTypeCode === 'string' ? serviceTypeCode.trim() : '';
  if (code === '') {
    return {
      ok: false,
      reason: 'service_type_required',
      message: 'Choose a service type — each service has its own workflow, so a case cannot be created without one.',
    };
  }
  const serviceName = options.serviceDisplayName?.(code) || code;
  if (options.activeServiceTypeCodes && !options.activeServiceTypeCodes.includes(code)) {
    return { ok: false, reason: 'unknown_service_type', message: `"${serviceName}" is not one of this organization's active service types.` };
  }

  const candidates = templates.filter(
    (t) => t.organizationId === organizationId && t.isEnabled && (t.serviceTypeCodes ?? []).includes(code),
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'no_template_for_service',
      message: `No workflow is configured for ${serviceName}. An administrator must set one up in Settings › Workflow Templates before cases can use it.`,
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous_service_template',
      message: `More than one enabled workflow is configured for ${serviceName}. An administrator must disable all but one in Settings › Workflow Templates.`,
    };
  }

  const template = candidates[0];
  const version = latestApprovedVersion(template);
  if (!version) {
    return { ok: false, reason: 'not_approved', message: notApprovedWorkflowMessage(serviceName) };
  }
  return { ok: true, template, version, serviceTypeCode: code };
}

/** Thrown by non-HTTP callers (mock create, the client hook) so the
    refusal's staff-facing message reaches the form unchanged. */
export class WorkflowSelectionError extends Error {
  constructor(
    public readonly reason: WorkflowSelectionRefusalReason,
    message: string,
  ) {
    super(message);
    this.name = 'WorkflowSelectionError';
  }
}
