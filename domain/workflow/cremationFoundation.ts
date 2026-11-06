import type { ChecklistItemTemplate, StageTemplate, WorkflowComposition } from '../../types/workflowTemplate';
import { STAGES, isBottleneckStage } from '../cases/stages';
import { getChecklistLabels, isFirstCallStage, PASSWORD_FIELD_PATTERN, PAYMENT_CONFIRMATION_LABEL } from '../cases/checklist';
import { getSlaTargetDays } from '../cases/sla';

/**
 * Shared cremation workflow foundation (2026-11).
 *
 * The one definition of the cremation process every funeral home's
 * cremation services are built on. It is NOT a second copy of the Manors
 * checklist: stages and items come from the very constants Manors' own
 * template is built from (STAGES, CHECKLIST_BY_RAW_STAGE via
 * getChecklistLabels, the SLA targets), and
 * cremationFoundation.test.ts proves the result is item-for-item the
 * Manors template. What it adds is a stable identity for every stage and
 * item (stageKey / stepId), so shared logic can find "Permit sent to
 * crematory" without depending on where an organization's template puts it.
 *
 * What stays per organization (CremationFoundationOptions, and each
 * organization's own profile):
 * - how the arrangement form is fulfilled (an external form integration
 *   such as JotForm, or staff confirmation) — the requirement is the same;
 * - what the organization calls each stage (names only);
 * - which Case fields complete "Certifier Information" (Manors requires
 *   name + fax since its template v7; the platform default is name + phone;
 *   each organization chooses in its profile, and an administrator can
 *   still change it per workflow version).
 * Recipients, prices, forms, branding and integrations never live here.
 *
 * Services extend the foundation (domain/workflow/workflowComposition.ts):
 *   Direct Cremation             = foundation
 *   Cremation with Viewing       = foundation + viewing steps
 *   Cremation with Final Goodbye = foundation + final goodbye steps
 * Extensions only ever ADD steps; they cannot remove or reorder the
 * cremation requirements.
 */

export const CREMATION_FOUNDATION_KEY = 'cremation.base';
export const CREMATION_FOUNDATION_VERSION = 1;

/** Stable stage keys, by raw stage (raw 0 and 1 share display stage 0). */
const STAGE_KEYS: readonly string[] = [
  'cremation.first_call',
  'cremation.payment',
  'cremation.arrangement_form',
  'cremation.edrs',
  'cremation.crematory',
  'cremation.death_certificate',
  'cremation.remains',
  'cremation.complete',
];

/** Stable step ids, by display stage then item index. */
const FIRST_CALL_AND_PAYMENT_STEPS = [
  'cremation.first_call.decedent_name',
  'cremation.first_call.place_of_death',
  'cremation.first_call.date_of_birth',
  'cremation.first_call.weight',
  'cremation.first_call.date_of_death',
  'cremation.first_call.time_of_death',
  'cremation.first_call.certifier',
  'cremation.first_call.family_contact',
  'cremation.payment.collected',
  'cremation.payment.card_by_phone',
  'cremation.payment.receipt_sent',
];

export const CREMATION_STEP_IDS: Readonly<Record<number, readonly string[]>> = {
  0: FIRST_CALL_AND_PAYMENT_STEPS,
  1: ['cremation.arrangement_form.completed'],
  2: ['cremation.edrs.submitted', 'cremation.edrs.cause_of_death', 'cremation.edrs.attestation'],
  3: ['cremation.crematory.permit_sent', 'cremation.crematory.authorization_sent'],
  4: ['cremation.death_certificate.application_filled', 'cremation.death_certificate.sent_before_remains'],
  5: [
    'cremation.remains.received',
    'cremation.remains.tag_photo',
    'cremation.remains.cross_checked',
    'cremation.remains.labels_made',
    'cremation.remains.transferred_to_urn',
    'cremation.remains.family_contacted',
  ],
  6: ['cremation.complete.family_received'],
};

/** The steps shared logic refers to by name. */
export const CREMATION_STEPS = {
  paymentCollected: 'cremation.payment.collected',
  arrangementFormCompleted: 'cremation.arrangement_form.completed',
  edrsSubmitted: 'cremation.edrs.submitted',
  causeOfDeath: 'cremation.edrs.cause_of_death',
  attestation: 'cremation.edrs.attestation',
  permitSent: 'cremation.crematory.permit_sent',
  authorizationSent: 'cremation.crematory.authorization_sent',
  remainsReceived: 'cremation.remains.received',
} as const;

export const PLATFORM_CERTIFIER_REQUIRED_CASE_FIELDS: readonly string[] = ['certifierName', 'certifierPhone'];
/** Name + fax: the certifier requirement Manors adopted with its template
    v7, and Gus's from the start (2026-11). An organization chooses it in its
    profile (features.certifierRequiredCaseFields). */
export const CERTIFIER_NAME_AND_FAX_CASE_FIELDS: readonly string[] = ['certifierName', 'certifierFax'];

export type CremationFoundationOptions = {
  /** The organization's own external form integration that fulfils the
      arrangement-form requirement, or null when staff confirm it by hand. */
  arrangementFormIntegrationId: string | null;
  /** Case fields that complete "Certifier Information". */
  certifierRequiredCaseFields?: readonly string[];
  /** The organization's own names for stages, by stage key (e.g. Gus calls
      the arrangement-form stage "JotForm Application"). Names only — the
      steps, their order and their ids never change. */
  stageLabels?: Readonly<Record<string, string>>;
};

const RAW_STAGE_COUNT = 8;
const toDisplayStage = (rawStage: number) => (rawStage === 0 ? 0 : rawStage - 1);
const CERTIFIER_INFORMATION_LABEL = 'Certifier Information';
const ARRANGEMENT_FORM_LABEL = 'Jotform application completed';

/** Plain confirmations, never typed values (see services/__mocks__/workflowTemplates.ts). */
const MANUAL_ONLY_LABELS = new Set<string>([
  PAYMENT_CONFIRMATION_LABEL,
  'Credit card payment collected by phone',
  'Payment receipt sent — confirms cleared to dispatch',
]);

function foundationItems(rawStage: number, options: CremationFoundationOptions): ChecklistItemTemplate[] {
  const displayStage = toDisplayStage(rawStage);
  const stepIds = CREMATION_STEP_IDS[displayStage] ?? [];
  // Typed values only on raw stage 0; the Time of death / Certifier rules
  // apply to both raw stages of First Call & Payment (raw 0 and 1 share
  // their items) — exactly as the Manors template defines them.
  const firstCall = isFirstCallStage(rawStage);
  const firstCallAndPayment = rawStage <= 1;
  return getChecklistLabels(rawStage).map((rawLabel, index): ChecklistItemTemplate => {
    const stepId = stepIds[index];
    if (firstCallAndPayment && index === 6) {
      return {
        index,
        label: CERTIFIER_INFORMATION_LABEL,
        hasField: false,
        isPasswordField: false,
        externalFormIntegrationId: null,
        requiredCaseFields: [...(options.certifierRequiredCaseFields ?? PLATFORM_CERTIFIER_REQUIRED_CASE_FIELDS)],
        stepId,
      };
    }
    return {
      index,
      label: rawLabel,
      hasField: firstCall && !MANUAL_ONLY_LABELS.has(rawLabel),
      isPasswordField: PASSWORD_FIELD_PATTERN.test(rawLabel),
      externalFormIntegrationId: rawLabel === ARRANGEMENT_FORM_LABEL ? options.arrangementFormIntegrationId : null,
      ...(firstCallAndPayment && index === 5 ? { valueKind: 'time' as const } : {}),
      stepId,
    };
  });
}

/** The cremation foundation's stages, ready to use as a template version's stages. */
export function buildCremationFoundationStages(options: CremationFoundationOptions): StageTemplate[] {
  return Array.from({ length: RAW_STAGE_COUNT }, (_, rawStage) => {
    const displayStage = toDisplayStage(rawStage);
    return {
      rawStage,
      displayStage,
      label: options.stageLabels?.[STAGE_KEYS[rawStage]] ?? STAGES[displayStage],
      isAttentionStage: isBottleneckStage(displayStage),
      slaTargetDays: getSlaTargetDays(displayStage),
      checklist: { items: foundationItems(rawStage, options) },
      stageKey: STAGE_KEYS[rawStage],
    };
  });
}

export function cremationFoundationComposition(extensions: WorkflowComposition['extensions'] = []): WorkflowComposition {
  return { base: { key: CREMATION_FOUNDATION_KEY, version: CREMATION_FOUNDATION_VERSION }, extensions };
}
