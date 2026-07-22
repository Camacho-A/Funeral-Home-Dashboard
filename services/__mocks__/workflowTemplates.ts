import type {
  WorkflowTemplate,
  StageTemplate,
  ChecklistItemTemplate,
  IntakeTemplate,
} from '../../types/workflowTemplate';
import { STAGES, isBottleneckStage } from '../../domain/cases/stages';
import { getChecklistLabels, isFirstCallStage, PASSWORD_FIELD_PATTERN } from '../../domain/cases/checklist';
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

function buildChecklistItems(rawStage: number): ChecklistItemTemplate[] {
  const labels = getChecklistLabels(rawStage);
  const hasField = isFirstCallStage(rawStage);
  return labels.map((label, index) => ({
    index,
    label,
    hasField,
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
const standardCremationIntake: IntakeTemplate = {
  sections: [
    {
      key: 'decedent',
      label: 'Decedent',
      fields: [
        { key: 'decedentName', label: 'Name of deceased', checklistItemIndex: 0, mapsToCaseField: 'decedentName' },
        {
          key: 'placeOfDeath',
          label: 'Place of death — name, address & phone number',
          checklistItemIndex: 1,
          mapsToCaseField: 'placeOfDeath',
        },
        {
          key: 'dateOfBirth',
          label: 'Date of birth',
          placeholder: 'MM/DD/YYYY',
          checklistItemIndex: 2,
          mapsToCaseField: 'dateOfBirth',
        },
        {
          key: 'weight',
          label: 'Weight',
          placeholder: 'e.g. 165 lb',
          checklistItemIndex: 3,
          mapsToCaseField: 'weight',
        },
        {
          key: 'dateOfDeath',
          label: 'Date of death',
          placeholder: 'MM/DD/YYYY',
          checklistItemIndex: 4,
          mapsToCaseField: 'dateOfDeath',
        },
        {
          key: 'timeOfDeath',
          label: 'Time of death',
          placeholder: '24hr, e.g. 14:30',
          checklistItemIndex: 5,
          mapsToCaseField: 'timeOfDeath',
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
        },
        { key: 'nextOfKinName', label: 'Next of kin — name', checklistItemIndex: 7, mapsToCaseField: 'nextOfKinName' },
        {
          key: 'nextOfKinPhone',
          label: 'Next of kin — phone number',
          checklistItemIndex: 7,
          mapsToCaseField: 'nextOfKinPhone',
        },
      ],
    },
    {
      key: 'payment',
      label: 'Payment',
      fields: [
        { key: 'cardName', label: 'Name on card', checklistItemIndex: 8 },
        { key: 'cardNumber', label: 'Card number', password: true, checklistItemIndex: 8 },
        { key: 'cardExp', label: 'Expiration (MM/YY)', checklistItemIndex: 8 },
        { key: 'cardCvv', label: 'CVV', password: true, checklistItemIndex: 8 },
        { key: 'cardZip', label: 'Billing zip code', checklistItemIndex: 8 },
      ],
    },
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
