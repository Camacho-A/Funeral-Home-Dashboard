import type { StageTemplate, IntakeTemplate } from '../../types/workflowTemplate';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Platform-owned
 * starter content for a brand-new organization's first workflow — plain
 * in-code data, never a persisted, cross-organization-shared Wix row.
 * `services/organizationProvisioningService.ts`'s `provisionWorkflow`
 * materializes one of these into a genuinely new, organization-owned
 * `WorkflowTemplate`/`WorkflowTemplateVersion` pair — the organization
 * never reads or depends on this module again after that point, so
 * editing this file later can never retroactively change an already-
 * provisioned organization's workflow (the same immutability guarantee
 * `CaseWorkflowSnapshot` already gives individual cases, one level up).
 *
 * Two content sets: `STARTER_WORKFLOW` (a genuinely usable generic
 * cremation-home workflow) and `MINIMAL_WORKFLOW` (the smallest workflow
 * that still functions — one stage, one checklist item, one intake
 * field) — matching this phase's "start from a minimal workflow" option
 * distinctly from "select a Beacon starter workflow".
 */
export type StarterWorkflowContent = {
  caseTypes: string[];
  stages: StageTemplate[];
  intake: IntakeTemplate;
};

export const STARTER_WORKFLOW: StarterWorkflowContent = {
  caseTypes: ['cremation'],
  stages: [
    {
      rawStage: 0,
      displayStage: 0,
      label: 'First Call',
      isAttentionStage: false,
      slaTargetDays: 1,
      checklist: {
        items: [
          { index: 0, label: 'Decedent information collected', hasField: true },
          { index: 1, label: 'Next of kin contacted', hasField: true },
        ],
      },
    },
    {
      rawStage: 1,
      displayStage: 1,
      label: 'Arrangements',
      isAttentionStage: false,
      slaTargetDays: 3,
      checklist: {
        items: [
          { index: 0, label: 'Authorization signed', hasField: false },
          { index: 1, label: 'Services selected', hasField: false },
        ],
      },
    },
    {
      rawStage: 2,
      displayStage: 2,
      label: 'Completed',
      isAttentionStage: false,
      slaTargetDays: null,
      checklist: { items: [] },
    },
  ],
  intake: {
    sections: [
      {
        key: 'decedent',
        label: 'Decedent',
        fields: [
          {
            key: 'decedentName',
            label: 'Name of deceased',
            fieldType: 'text',
            required: true,
            uppercase: true,
            mapsToCaseField: 'decedentName',
          },
          {
            key: 'dateOfDeath',
            label: 'Date of death',
            fieldType: 'date',
            validationType: 'date',
            mapsToCaseField: 'dateOfDeath',
          },
          {
            key: 'placeOfDeath',
            label: 'Place of death',
            fieldType: 'text',
            uppercase: true,
            mapsToCaseField: 'placeOfDeath',
          },
        ],
      },
      {
        key: 'contact',
        label: 'Family Contact',
        fields: [
          {
            key: 'nextOfKinName',
            label: 'Next of kin — name',
            fieldType: 'text',
            uppercase: true,
            mapsToCaseField: 'nextOfKinName',
          },
          {
            key: 'nextOfKinPhone',
            label: 'Next of kin — phone number',
            fieldType: 'phone',
            validationType: 'phone',
            mapsToCaseField: 'nextOfKinPhone',
          },
        ],
      },
    ],
  },
};

export const MINIMAL_WORKFLOW: StarterWorkflowContent = {
  caseTypes: ['general'],
  stages: [
    {
      rawStage: 0,
      displayStage: 0,
      label: 'Open',
      isAttentionStage: false,
      slaTargetDays: null,
      checklist: { items: [{ index: 0, label: 'Case reviewed', hasField: false }] },
    },
  ],
  intake: {
    sections: [
      {
        key: 'decedent',
        label: 'Decedent',
        fields: [
          {
            key: 'decedentName',
            label: 'Name of deceased',
            fieldType: 'text',
            required: true,
            uppercase: true,
            mapsToCaseField: 'decedentName',
          },
        ],
      },
    ],
  },
};
