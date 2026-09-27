import type {
  WorkflowTemplate,
  StageTemplate,
  ChecklistItemTemplate,
  IntakeTemplate,
} from '../../types/workflowTemplate';
import { STAGES, isBottleneckStage } from '../../domain/cases/stages';
import {
  getChecklistLabels,
  isFirstCallStage,
  PASSWORD_FIELD_PATTERN,
  PAYMENT_CONFIRMATION_LABEL,
} from '../../domain/cases/checklist';
import { getSlaTargetDays } from '../../domain/cases/sla';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './organizationIds';
import { JOTFORM_INTEGRATION_ID } from './externalFormIntegrations';

/**
 * Phase 11 (Workflow Template Architecture). Managed Cremations' template is
 * *built from* the pre-Phase-11 constants (domain/cases/stages.ts's STAGES/
 * isBottleneckStage, checklist.ts's getChecklistLabels/isFirstCallStage,
 * sla.ts's getSlaTargetDays) rather than hand-retyped — this guarantees the
 * fixture can never silently drift from what those constants already
 * describe, and it's how "Managed Cremations must behave exactly as before"
 * is actually enforced rather than merely asserted. Those constants
 * themselves are unchanged (see docs/TEMPLATE_VERSIONING.md's "Known scope
 * limits") — Dashboard/Reports still read them directly, since there's no
 * UI to switch the active organization and reach a second organization's
 * differently-shaped stages.
 */

function toDisplayStage(rawStage: number): number {
  return rawStage === 0 ? 0 : rawStage - 1;
}

// CHECKLIST_BY_RAW_STAGE (domain/cases/checklist.ts) has keys 0-7 — 8 raw
// stages, combining down to STAGES.length (7) display stages since raw 0
// and 1 both display as "First Call & Payment".
const RAW_STAGE_COUNT = 8;

// Manual-checklist-item fix (2026-09): every one of these is a plain
// checkbox confirmation, never a free-text box — there is no field on
// Case Detail for a value to ever be typed into, and no code path (normal
// intake or historical import) ever populates a fieldValues index for
// any of them. "Payment collected" was already correctly excluded;
// "Credit card payment collected by phone" and "Payment receipt sent"
// were incorrectly left as hasField: true, making them permanently
// unsatisfiable via any real data path. A named set (rather than
// special-casing only PAYMENT_CONFIRMATION_LABEL) makes this exclusion
// legible as "these three are manual," not an accretion of one-off
// checks. Business behavior is unchanged: checklistState[8]
// (markCasePaidIfVerified) and every other checklist item are untouched;
// "Payment receipt sent" and "Credit card payment collected by phone"
// remain manual, never auto-completed by this change.
const MANUAL_ONLY_CHECKLIST_LABELS = new Set<string>([
  PAYMENT_CONFIRMATION_LABEL,
  'Credit card payment collected by phone',
  'Payment receipt sent — confirms cleared to dispatch',
]);

function buildChecklistItems(rawStage: number): ChecklistItemTemplate[] {
  const labels = getChecklistLabels(rawStage);
  const stageHasFields = isFirstCallStage(rawStage);
  return labels.map((label, index) => ({
    index,
    label,
    hasField: stageHasFields && !MANUAL_ONLY_CHECKLIST_LABELS.has(label),
    isPasswordField: PASSWORD_FIELD_PATTERN.test(label),
    externalFormIntegrationId: label === 'Jotform application completed' ? JOTFORM_INTEGRATION_ID : null,
  }));
}

const standardCremationStages: StageTemplate[] = Array.from(
  { length: RAW_STAGE_COUNT },
  (_, rawStage) => {
    const displayStage = toDisplayStage(rawStage);
    return {
      rawStage,
      displayStage,
      label: STAGES[displayStage],
      isAttentionStage: isBottleneckStage(displayStage),
      slaTargetDays: getSlaTargetDays(displayStage),
      checklist: { items: buildChecklistItems(rawStage) },
    };
  },
);

/**
 * Mirrors NewCaseModal's pre-Phase-11 hardcoded FIELD_GROUPS exactly (same
 * keys, labels, placeholders, grouping, order) — see that component's own
 * comment for why "Family contact" is two fields (nextOfKinName/Phone)
 * instead of the original single combined string, and why "Your name
 * (taking this call)" isn't part of this template at all (it's the
 * immutable intake owner, sourced from the trusted session, never a
 * template-driven form field — see domain/cases/intakeOwnership.ts).
 * checklistItemIndex values match CHECKLIST_BY_RAW_STAGE[0]'s combined
 * 11-item layout (indices 0-8); 9-10 (payment collected / receipt sent)
 * aren't intake-time facts, so no field maps to them, matching the old
 * buildIntakeFieldValues exactly.
 */
/**
 * Phase 19 (Configurable Intake Form Builder): every field below now sets
 * the fieldType/uppercase/required/validationType that
 * components/modals/NewCaseModal.tsx used to hardcode by literal key name
 * (UPPERCASE_FIELD_KEYS/DATE_FIELD_KEYS/EXPIRY_FIELD_KEYS, now removed) —
 * chosen to reproduce that exact prior behavior, not to add new
 * validation Managed Cremations never had.
 *
 * Phase 19A (Secure Payment Architecture): the "Payment" section's five
 * separate card sub-fields (cardName/cardNumber/cardExp/cardCvv/cardZip,
 * the last two `password: true`) are gone — replaced by one `fieldType:
 * 'payment'` field below. See that field's own comment.
 */
const standardCremationIntake: IntakeTemplate = {
  sections: [
    {
      key: 'decedent',
      label: 'Decedent',
      fields: [
        {
          key: 'decedentName',
          label: 'Name of deceased',
          checklistItemIndex: 0,
          mapsToCaseField: 'decedentName',
          fieldType: 'text',
          uppercase: true,
          required: true,
        },
        {
          key: 'placeOfDeath',
          label: 'Place of death — name, address & phone number',
          checklistItemIndex: 1,
          mapsToCaseField: 'placeOfDeath',
          fieldType: 'text',
          uppercase: true,
        },
        {
          key: 'dateOfBirth',
          label: 'Date of birth',
          placeholder: 'MM/DD/YYYY',
          checklistItemIndex: 2,
          mapsToCaseField: 'dateOfBirth',
          fieldType: 'date',
          validationType: 'date',
        },
        {
          key: 'weight',
          label: 'Weight',
          placeholder: 'e.g. 165 lb',
          checklistItemIndex: 3,
          mapsToCaseField: 'weight',
          fieldType: 'text',
        },
        {
          key: 'dateOfDeath',
          label: 'Date of death',
          placeholder: 'MM/DD/YYYY',
          checklistItemIndex: 4,
          mapsToCaseField: 'dateOfDeath',
          fieldType: 'date',
          validationType: 'date',
        },
        {
          key: 'timeOfDeath',
          label: 'Time of death',
          placeholder: '24hr, e.g. 14:30',
          checklistItemIndex: 5,
          mapsToCaseField: 'timeOfDeath',
          fieldType: 'time',
        },
      ],
    },
    {
      key: 'contacts',
      label: 'Contacts',
      fields: [
        {
          key: 'dcContact',
          label: 'Hospice or physician to sign DC — name & phone number',
          checklistItemIndex: 6,
          fieldType: 'text',
          uppercase: true,
        },
        {
          key: 'nextOfKinName',
          label: 'Next of kin — name',
          checklistItemIndex: 7,
          mapsToCaseField: 'nextOfKinName',
          fieldType: 'text',
          uppercase: true,
        },
        {
          key: 'nextOfKinPhone',
          label: 'Next of kin — phone number',
          checklistItemIndex: 7,
          mapsToCaseField: 'nextOfKinPhone',
          fieldType: 'phone',
        },
      ],
    },
    {
      key: 'payment',
      label: 'Payment',
      fields: [
        /**
         * Phase 19A (Secure Payment Architecture) replaced five separate
         * card sub-fields (cardName/cardNumber/cardExp/cardCvv/cardZip)
         * with this single field, since that shape let
         * buildIntakeFieldValues concatenate a PAN, expiration, and CVV
         * into one plaintext string and persist it in Case.fieldValues, in
         * Wix, permanently. A 'payment' field has no checklistItemIndex
         * and no mapsToCaseField — it structurally cannot contribute to
         * fieldValues or a Case property (see
         * domain/workflow/resolveIntake.ts's explicit skip for this
         * fieldType).
         *
         * Phase 19B (Clover Hosted Checkout Integration): now purely
         * informational at intake time — `required` is never checked for
         * a payment field (see NewCaseModal.tsx's hasMissingRequired),
         * since there is nothing to fill in here at all. Real, verified
         * payment collection happens afterward, on Case Detail, via
         * components/case/CaseOrderCard.tsx's "Collect with Clover" flow.
         * See docs/adr/ADR-022-clover-hosted-checkout-integration.md.
         */
        {
          key: 'payment',
          label: 'Payment',
          fieldType: 'payment',
          paymentPurpose: 'Cremation service fee',
          paymentDescription: 'Collected securely via Clover once the case is created — not during intake.',
        },
      ],
    },
  ],
};

/**
 * Structured Certifier data (2026-09, ADR-041) — version 5. Append-only:
 * version 1 (standardCremationStages/standardCremationIntake) above is
 * completely untouched, so every existing case's frozen workflowSnapshot
 * (built at creation time from whichever version was latest then) keeps
 * resolving exactly as it always has. This version only changes two things
 * from v1, both scoped to raw stages 0/1's combined 11-item First-Call-
 * and-Payment checklist (the only place indices 5/6 mean "Time of death"/
 * "Certifier"):
 *  - index 5 ("Time of death") gains valueKind: 'time', so ChecklistCard
 *    renders a 12-hour editor for it from template metadata, not a label
 *    match.
 *  - index 6 ("Hospice or physician who will sign the DC") is replaced
 *    with a generic, non-field-backed "Certifier Information" item whose
 *    completion is computed from structured Case data
 *    (requiredCaseFields), matching the terminal return-of-remains item's
 *    existing isDerived precedent instead of inventing a new UI concept.
 * Every other raw stage (2-7) is byte-for-byte the same output as v1's
 * buildChecklistItems, since indices 5/6 don't appear in their (much
 * shorter) item lists.
 */
function buildChecklistItemsV5(rawStage: number): ChecklistItemTemplate[] {
  return buildChecklistItems(rawStage).map((item) => {
    if (rawStage > 1) return item;
    if (item.index === 5) {
      return { ...item, valueKind: 'time' };
    }
    if (item.index === 6) {
      return {
        index: 6,
        label: 'Certifier Information',
        hasField: false,
        isPasswordField: false,
        externalFormIntegrationId: null,
        requiredCaseFields: ['certifierName', 'certifierPhone'],
      };
    }
    return item;
  });
}

const standardCremationStagesV5: StageTemplate[] = Array.from(
  { length: RAW_STAGE_COUNT },
  (_, rawStage) => {
    const displayStage = toDisplayStage(rawStage);
    return {
      rawStage,
      displayStage,
      label: STAGES[displayStage],
      isAttentionStage: isBottleneckStage(displayStage),
      slaTargetDays: getSlaTargetDays(displayStage),
      checklist: { items: buildChecklistItemsV5(rawStage) },
    };
  },
);

/**
 * Replaces the single dcContact free-text field with four structured
 * Certifier fields — none given a checklistItemIndex (so
 * buildIntakeFieldValues/findChecklistIndexForCaseField never populate a
 * fieldValues entry for them; the Certifier Information checklist item's
 * completion is driven entirely by requiredCaseFields above, never by
 * fieldValues) and none marked required at intake level (matching
 * dcContact's own prior non-required posture — Name/Phone are required
 * for *checklist completion*, not for New Case *submission*, exactly the
 * distinction this phase's design settled on). certifierPhone/
 * certifierFax use fieldType: 'phone' — the closest existing type, since
 * no 'fax' fieldType exists and no phone/fax masking convention exists
 * anywhere in SOLIS to invent one for (nextOfKinPhone is unmasked too).
 * decedent and payment sections are unchanged from v1.
 */
const standardCremationIntakeV5: IntakeTemplate = {
  sections: [
    standardCremationIntake.sections[0],
    {
      key: 'contacts',
      label: 'Contacts',
      fields: [
        {
          key: 'certifierName',
          label: 'Certifier — name',
          mapsToCaseField: 'certifierName',
          fieldType: 'text',
          uppercase: true,
        },
        {
          key: 'certifierPhone',
          label: 'Certifier — phone number',
          mapsToCaseField: 'certifierPhone',
          fieldType: 'phone',
        },
        {
          key: 'certifierLicenseNumber',
          label: 'Certifier — license number',
          mapsToCaseField: 'certifierLicenseNumber',
          fieldType: 'text',
          uppercase: true,
        },
        {
          key: 'certifierFax',
          label: 'Certifier — fax number',
          mapsToCaseField: 'certifierFax',
          fieldType: 'phone',
        },
        {
          key: 'nextOfKinName',
          label: 'Next of kin — name',
          checklistItemIndex: 7,
          mapsToCaseField: 'nextOfKinName',
          fieldType: 'text',
          uppercase: true,
        },
        {
          key: 'nextOfKinPhone',
          label: 'Next of kin — phone number',
          checklistItemIndex: 7,
          mapsToCaseField: 'nextOfKinPhone',
          fieldType: 'phone',
        },
      ],
    },
    standardCremationIntake.sections[2],
  ],
};

export const STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID = 'workflow-template-standard-cremation';

export const standardCremationWorkflowTemplateFixture: WorkflowTemplate = {
  id: STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID,
  organizationId: DEFAULT_ORGANIZATION_ID,
  name: 'Standard Cremation Workflow',
  isEnabled: true,
  caseTypes: ['cremation'],
  versions: [
    {
      version: 1,
      caseTypes: ['cremation'],
      stages: standardCremationStages,
      intake: standardCremationIntake,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      version: 5,
      caseTypes: ['cremation'],
      stages: standardCremationStagesV5,
      intake: standardCremationIntakeV5,
      createdAt: '2026-09-26T00:00:00.000Z',
    },
  ],
};

/**
 * A second mock organization's workflow — deliberately a different shape
 * (3 stages vs. 7, no combined raw/display stages, a different attention
 * stage, no card-payment or JotForm items) — used only by tests to prove
 * the domain/workflow/ resolution functions work for *any* template, not
 * just Managed Cremations' one. Not reachable through the running app: no
 * UI switches the active organization (see hooks/useOrganization.tsx).
 */
const secondOrgStages: StageTemplate[] = [
  {
    rawStage: 0,
    displayStage: 0,
    label: 'Intake',
    isAttentionStage: false,
    slaTargetDays: 1,
    checklist: {
      items: [
        { index: 0, label: 'Family contacted', hasField: false },
        { index: 1, label: 'Service preferences recorded', hasField: false },
      ],
    },
  },
  {
    rawStage: 1,
    displayStage: 1,
    label: 'Preparation',
    isAttentionStage: true,
    slaTargetDays: 2,
    checklist: {
      items: [{ index: 0, label: 'Embalming completed', hasField: false }],
    },
  },
  {
    rawStage: 2,
    displayStage: 2,
    label: 'Service Scheduled',
    isAttentionStage: false,
    slaTargetDays: null,
    checklist: {
      items: [{ index: 0, label: 'Venue confirmed', hasField: false }],
    },
  },
];

const secondOrgIntake: IntakeTemplate = {
  sections: [
    {
      key: 'decedent',
      label: 'Decedent',
      fields: [{ key: 'decedentName', label: 'Full name', mapsToCaseField: 'decedentName' }],
    },
  ],
};

export const SECOND_ORG_WORKFLOW_TEMPLATE_ID = 'workflow-template-evergreen-burial';

export const secondOrgWorkflowTemplateFixture: WorkflowTemplate = {
  id: SECOND_ORG_WORKFLOW_TEMPLATE_ID,
  organizationId: SECOND_MOCK_ORGANIZATION_ID,
  name: 'Evergreen Memorial Group — Burial Workflow',
  isEnabled: true,
  caseTypes: ['burial'],
  versions: [
    {
      version: 1,
      caseTypes: ['burial'],
      stages: secondOrgStages,
      intake: secondOrgIntake,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

export const workflowTemplateFixtures: WorkflowTemplate[] = [
  standardCremationWorkflowTemplateFixture,
  secondOrgWorkflowTemplateFixture,
];
