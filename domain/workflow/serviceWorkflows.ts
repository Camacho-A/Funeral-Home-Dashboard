import type { IntakeTemplate, StageTemplate, WorkflowTemplateVersion, WorkflowTemplateVersionStatus } from '../../types/workflowTemplate';
import { COMPLETION_REQUIREMENTS_TO_BE_DEFINED_NOTE, finalItemsCompletionPolicy, remainsReturnCompletionPolicy, PLACEHOLDER_STAGE_SUFFIX } from './completionPolicy';
import { renumberWorkflowStages } from './templateEditing';
import { buildCremationFoundationStages, CREMATION_FOUNDATION_KEY, CREMATION_FOUNDATION_VERSION, type CremationFoundationOptions } from './cremationFoundation';
import { composeWorkflowStages, compositionOf, type WorkflowExtension } from './workflowComposition';
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
    // A cremation case is finished when the cremated remains are returned
    // to the family — the rule every cremation case already follows.
    completionPolicy: remainsReturnCompletionPolicy(),
  };
}

/** The foundation options an organization's service workflows are built
    with: its own arrangement-form binding (or none) and its certifier
    requirement from its profile (platform default when it sets none). */
export function foundationOptionsFor(
  organizationId: string,
  options: { arrangementFormIntegrationId: string | null },
): CremationFoundationOptions {
  const { certifierRequiredCaseFields, cremationStageLabels } = getRegisteredOrganizationProfile(organizationId).features;
  return {
    arrangementFormIntegrationId: options.arrangementFormIntegrationId,
    ...(certifierRequiredCaseFields ? { certifierRequiredCaseFields } : {}),
    ...(cremationStageLabels ? { stageLabels: cremationStageLabels } : {}),
  };
}

/** The name staff see for a service code, or the code itself if unknown. */
export function serviceTypeName(code: string | null | undefined): string | null {
  if (!code) return null;
  return (CREMATION_SERVICE_WORKFLOWS as Record<string, ServiceWorkflowDefinition>)[code]?.name ?? code;
}

/**
 * Burial and entombment services (2026-11, kept from Gus SOLIS). Their own
 * steps have not been supplied, so each is a DRAFT that cases cannot use:
 * the service-neutral steps of the shared process only (first call and
 * payment, arrangement form, EDRS and cause of death, the death
 * certificate application) — every crematory and cremated-remains step
 * removed, nothing invented — plus one empty "<service> — steps to be
 * defined" stage, which approval refuses until an administrator defines
 * the steps and the completion items.
 */
export const SERVICE_NEUTRAL_DRAFT_SERVICES = [
  { serviceTypeCode: 'GRAVESIDE_BURIAL_SERVICE_ONLY', name: 'Graveside Burial Service Only (No Viewing)', serviceLabel: 'Graveside burial', caseType: 'burial' },
  { serviceTypeCode: 'VETERANS_GRAVESIDE_BURIAL_SERVICE_ONLY', name: 'U.S. Veterans, Graveside Burial Service Only (No Viewing)', serviceLabel: 'Veterans graveside burial', caseType: 'burial' },
  { serviceTypeCode: 'DIRECT_ENTOMBMENT', name: 'Direct Entombment (Embalming Required)', serviceLabel: 'Entombment', caseType: 'entombment' },
] as const;

const CREMATION_ONLY_STAGE_KEYS = new Set(['cremation.crematory', 'cremation.remains']);
const CREMATION_ONLY_STEP_IDS = new Set(['cremation.death_certificate.sent_before_remains', 'cremation.complete.family_received']);

export function placeholderStageLabel(serviceLabel: string): string {
  return `${serviceLabel} — ${PLACEHOLDER_STAGE_SUFFIX}`;
}

function serviceNeutralStages(foundation: CremationFoundationOptions, serviceTypeCode: string, serviceLabel: string): StageTemplate[] {
  const neutral = buildCremationFoundationStages(foundation)
    .filter((stage) => !CREMATION_ONLY_STAGE_KEYS.has(stage.stageKey ?? ''))
    .map((stage) => ({ ...stage, checklist: { items: stage.checklist.items.filter((item) => !CREMATION_ONLY_STEP_IDS.has(item.stepId ?? '')) } }));
  const placeholder: StageTemplate = {
    rawStage: 0,
    displayStage: 0,
    label: placeholderStageLabel(serviceLabel),
    isAttentionStage: false,
    slaTargetDays: null,
    checklist: { items: [] },
    stageKey: `service.${serviceTypeCode.toLowerCase()}.to_be_defined`,
  };
  const numbered = renumberWorkflowStages(neutral);
  return renumberWorkflowStages([...numbered.slice(0, -1), placeholder, numbered[numbered.length - 1]]);
}

/**
 * The cremation services an organization that chooses workflows by service
 * is set up with (onboarding, and the local mock data): one template per
 * service, each the shared foundation plus that service's extensions, with
 * the organization's own foundation options. Approved from the start —
 * they ARE the cremation process the funeral home confirmed; a later edit
 * goes through the organization's own approval rule.
 */
export type ServiceWorkflowTemplateDefinition = {
  serviceTypeCode: string;
  status: WorkflowTemplateVersionStatus;
  name: string;
  description: string;
  caseTypes: string[];
  version: WorkflowTemplateVersion;
};

export function buildServiceWorkflowTemplateDefinitions(params: {
  organizationId: string;
  arrangementFormIntegrationId: string | null;
  intake: IntakeTemplate;
  createdAt: string;
}): ServiceWorkflowTemplateDefinition[] {
  const foundation = foundationOptionsFor(params.organizationId, { arrangementFormIntegrationId: params.arrangementFormIntegrationId });
  const cremation = Object.values(CREMATION_SERVICE_WORKFLOWS).map((definition): ServiceWorkflowTemplateDefinition => ({
    serviceTypeCode: definition.serviceTypeCode,
    status: 'approved',
    name: definition.name,
    description: definition.extensions.some((e) => e.stepsToBeDefined)
      ? `The shared cremation process. ${definition.extensions.map((e) => e.label).join(', ')} steps are to be defined; until then this service runs the cremation steps only.`
      : 'The shared cremation process.',
    caseTypes: [definition.caseType],
    version: { ...buildServiceWorkflowVersion({ definition, foundation, intake: params.intake, version: 1, createdAt: params.createdAt }), status: 'approved' },
  }));
  const drafts = SERVICE_NEUTRAL_DRAFT_SERVICES.map((service): ServiceWorkflowTemplateDefinition => ({
    serviceTypeCode: service.serviceTypeCode,
    status: 'draft',
    name: service.name,
    description: `DRAFT — requires approval. Only the service-neutral steps of the shared process are included; every crematory and cremated-remains step was removed. The ${service.serviceLabel} steps have not been supplied: the "${placeholderStageLabel(service.serviceLabel)}" stage has no checklist items, so this version cannot be approved until an administrator defines them.`,
    caseTypes: [service.caseType],
    version: {
      version: 1,
      caseTypes: [service.caseType],
      stages: serviceNeutralStages(foundation, service.serviceTypeCode, service.serviceLabel),
      intake: structuredClone(params.intake),
      createdAt: params.createdAt,
      status: 'draft',
      serviceTypeCodes: [service.serviceTypeCode],
      completionPolicy: finalItemsCompletionPolicy({
        note: `${COMPLETION_REQUIREMENTS_TO_BE_DEFINED_NOTE} No cremated remains are returned for ${service.serviceLabel.toLowerCase()} — choose the final checklist item(s) that complete a case before approving.`,
      }),
    },
  }));
  return [...cremation, ...drafts];
}
