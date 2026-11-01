import type { IntakeTemplate, WorkflowTemplate, WorkflowTemplateVersion } from '../../types/workflowTemplate';
import { buildCremationFoundationStages, CREMATION_FOUNDATION_KEY, CREMATION_FOUNDATION_VERSION, type CremationFoundationOptions } from './cremationFoundation';
import { composeWorkflowStages, compositionOf, type WorkflowExtension } from './workflowComposition';
import { latestTemplateVersion } from './snapshot';
import { getRegisteredOrganizationProfile } from '../organization/organizationProfiles';

/**
 * Service-based workflows (2026-11). Platform-level definitions of the
 * cremation services a funeral home can offer, each built on the one
 * shared cremation foundation. Organization-specific values (prices,
 * forms, recipients) are never here — a funeral home chooses which of
 * these services it offers and how its forms fulfil the requirements.
 *
 * Viewing and Final Goodbye are declared as extensions with no steps yet:
 * the funeral home has not defined them, and inventing them would put
 * steps in front of staff that nobody asked for. Until they are defined
 * these services run the cremation foundation unchanged; adding their
 * steps later is a new extension version, with no change to the
 * cremation requirements or to existing cases.
 */

export const SERVICE_TYPE_CODES = {
  DIRECT_CREMATION: 'DIRECT_CREMATION',
  CREMATION_WITH_VIEWING: 'CREMATION_WITH_VIEWING',
  CREMATION_WITH_FINAL_GOODBYE: 'CREMATION_WITH_FINAL_GOODBYE',
} as const;
export type CremationServiceTypeCode = (typeof SERVICE_TYPE_CODES)[keyof typeof SERVICE_TYPE_CODES];

export const VIEWING_EXTENSION: WorkflowExtension = {
  key: 'service.viewing',
  version: 1,
  label: 'Viewing',
  stepsToBeDefined: true,
  additions: [],
};

export const FINAL_GOODBYE_EXTENSION: WorkflowExtension = {
  key: 'service.final_goodbye',
  version: 1,
  label: 'Final Goodbye',
  stepsToBeDefined: true,
  additions: [],
};

export type ServiceWorkflowDefinition = {
  serviceTypeCode: CremationServiceTypeCode;
  name: string;
  caseType: 'cremation';
  extensions: WorkflowExtension[];
};

export const CREMATION_SERVICE_WORKFLOWS: Readonly<Record<CremationServiceTypeCode, ServiceWorkflowDefinition>> = {
  DIRECT_CREMATION: { serviceTypeCode: 'DIRECT_CREMATION', name: 'Direct Cremation', caseType: 'cremation', extensions: [] },
  CREMATION_WITH_VIEWING: { serviceTypeCode: 'CREMATION_WITH_VIEWING', name: 'Cremation with Viewing', caseType: 'cremation', extensions: [VIEWING_EXTENSION] },
  CREMATION_WITH_FINAL_GOODBYE: {
    serviceTypeCode: 'CREMATION_WITH_FINAL_GOODBYE',
    name: 'Cremation with Final Goodbye',
    caseType: 'cremation',
    extensions: [FINAL_GOODBYE_EXTENSION],
  },
};

/** A template version for one service: the cremation foundation plus that service's extensions. */
export function buildServiceWorkflowVersion(params: {
  definition: ServiceWorkflowDefinition;
  foundation: CremationFoundationOptions;
  intake: IntakeTemplate;
  version: number;
  createdAt: string;
}): WorkflowTemplateVersion {
  const { definition } = params;
  return {
    version: params.version,
    caseTypes: [definition.caseType],
    stages: composeWorkflowStages(buildCremationFoundationStages(params.foundation), definition.extensions),
    intake: structuredClone(params.intake),
    createdAt: params.createdAt,
    serviceTypeCodes: [definition.serviceTypeCode],
    composition: compositionOf(CREMATION_FOUNDATION_KEY, CREMATION_FOUNDATION_VERSION, definition.extensions),
  };
}

/** The foundation options an organization's service workflows are built
    with: its own arrangement-form binding (or none) and its certifier
    requirement from its profile (platform default when it sets none). */
export function foundationOptionsFor(
  organizationId: string,
  options: { arrangementFormIntegrationId: string | null },
): CremationFoundationOptions {
  const certifier = getRegisteredOrganizationProfile(organizationId).features.certifierRequiredCaseFields;
  return { arrangementFormIntegrationId: options.arrangementFormIntegrationId, ...(certifier ? { certifierRequiredCaseFields: certifier } : {}) };
}

/** The name staff see for a service code, or the code itself if unknown. */
export function serviceTypeName(code: string | null | undefined): string | null {
  if (!code) return null;
  return (CREMATION_SERVICE_WORKFLOWS as Record<string, ServiceWorkflowDefinition>)[code]?.name ?? code;
}

export type ServiceOption = { serviceTypeCode: string; name: string; templateId: string };

/** The services an organization's enabled templates offer, in a stable order. */
export function serviceOptionsFor(templates: readonly WorkflowTemplate[]): ServiceOption[] {
  const order = Object.keys(CREMATION_SERVICE_WORKFLOWS);
  const options: ServiceOption[] = [];
  for (const template of templates) {
    if (!template.isEnabled || template.versions.length === 0) continue;
    for (const code of latestTemplateVersion(template).serviceTypeCodes ?? []) {
      if (!options.some((o) => o.serviceTypeCode === code)) options.push({ serviceTypeCode: code, name: serviceTypeName(code) ?? code, templateId: template.id });
    }
  }
  return options.sort((a, b) => {
    const ia = order.indexOf(a.serviceTypeCode), ib = order.indexOf(b.serviceTypeCode);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name);
  });
}

export type TemplateSelection =
  | { ok: true; template: WorkflowTemplate; version: WorkflowTemplateVersion | null; serviceTypeCode: string | null }
  | { ok: false; reason: 'service_required' | 'unknown_service' | 'ambiguous_service' | 'no_template' };

/**
 * Picks the workflow a new case is created on.
 * - An organization that chooses workflows by service must name one of the
 *   services its enabled templates offer; exactly one template may serve it.
 * - Every other organization (Manors) keeps the rule it always had: the
 *   first enabled template, at its latest version, whatever is passed.
 */
export function selectWorkflowTemplate(
  templates: readonly WorkflowTemplate[],
  options: { workflowByServiceType: boolean; serviceTypeCode?: string | null },
): TemplateSelection {
  if (!options.workflowByServiceType) {
    // Exactly the rule this organization always had: the first enabled
    // template (its latest version, when it has one).
    const template = templates.find((t) => t.isEnabled);
    if (!template) return { ok: false, reason: 'no_template' };
    return { ok: true, template, version: template.versions?.length ? latestTemplateVersion(template) : null, serviceTypeCode: null };
  }
  const enabled = templates.filter((t) => t.isEnabled && (t.versions?.length ?? 0) > 0);
  const code = options.serviceTypeCode?.trim();
  if (!code) return { ok: false, reason: 'service_required' };
  const matches = enabled.filter((t) => (latestTemplateVersion(t).serviceTypeCodes ?? []).includes(code));
  if (matches.length === 0) return { ok: false, reason: 'unknown_service' };
  if (matches.length > 1) return { ok: false, reason: 'ambiguous_service' };
  return { ok: true, template: matches[0], version: latestTemplateVersion(matches[0]), serviceTypeCode: code };
}

export const TEMPLATE_SELECTION_MESSAGES: Record<Exclude<TemplateSelection, { ok: true }>['reason'], string> = {
  service_required: 'Choose the service for this case.',
  unknown_service: 'That service is not offered by this funeral home.',
  ambiguous_service: 'More than one workflow is set up for that service. Ask an administrator to fix the workflow settings.',
  no_template: 'No enabled workflow template found for this organization.',
};

/** Whether this organization opens every case for a named service. */
export function isWorkflowByServiceType(organizationId: string | null | undefined): boolean {
  return organizationId ? getRegisteredOrganizationProfile(organizationId).features.workflowByServiceType === true : false;
}
