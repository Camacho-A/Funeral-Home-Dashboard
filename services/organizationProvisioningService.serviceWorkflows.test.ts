import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionWorkflow, getOrganizationWorkflow } from './organizationProvisioningService';
import { workflowTemplateFixtures } from './__mocks__/workflowTemplates';
import { selectWorkflowTemplate } from '../domain/workflow/selectWorkflowTemplate';
import { CREMATION_STEPS } from '../domain/workflow/cremationFoundation';
import { findStep } from '../domain/workflow/workflowSteps';
import type { WorkflowTemplate } from '../types/workflowTemplate';

/**
 * Service-based workflows (2026-11). Onboarding provisions an
 * organization's cremation services from the shared cremation foundation —
 * mock data only.
 */

const GUS = 'gus-camacho-jr';

let templatesBefore: WorkflowTemplate[];
beforeEach(() => {
  templatesBefore = structuredClone(workflowTemplateFixtures);
  // Start from a backend where Gus has no workflow yet, as in production.
  workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...workflowTemplateFixtures.filter((t) => t.organizationId !== GUS));
});
afterEach(() => {
  workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...templatesBefore);
});

function ids() {
  let n = 0;
  return () => `gus-provisioned-${++n}`;
}

describe("provisionWorkflow({ mode: 'service_workflows' })", () => {
  it('creates one organization-owned template per service: the cremation services from the shared foundation, usable; burial/entombment as drafts', async () => {
    const othersBefore = JSON.stringify(workflowTemplateFixtures);
    const result = await provisionWorkflow(GUS, { mode: 'service_workflows' }, ids(), 'mock');
    expect(result.isNew).toBe(true);
    expect(result.templates!.map((t) => t.serviceTypeCodes)).toEqual([
      ['DIRECT_CREMATION'],
      ['CREMATION_WITH_VIEWING'],
      ['CREMATION_WITH_FINAL_GOODBYE'],
      ['GRAVESIDE_BURIAL_SERVICE_ONLY'],
      ['VETERANS_GRAVESIDE_BURIAL_SERVICE_ONLY'],
      ['DIRECT_ENTOMBMENT'],
    ]);
    expect(result.templates!.map((t) => t.versions[0].status)).toEqual(['approved', 'approved', 'approved', 'draft', 'draft', 'draft']);
    for (const t of result.templates!.slice(0, 3)) {
      expect(t.organizationId).toBe(GUS);
      const version = t.versions[0];
      expect(version.composition?.base.key).toBe('cremation.base');
      // The cremation requirements are all there, found by their stable ids.
      for (const stepId of Object.values(CREMATION_STEPS)) expect(findStep(version.stages, stepId)).not.toBeNull();
      // Gus's certifier requirement (its profile): name + fax.
      expect(version.stages.flatMap((stage) => stage.checklist.items).find((i) => i.stepId === 'cremation.first_call.certifier')?.requiredCaseFields).toEqual(['certifierName', 'certifierFax']);
    }
    // Viewing / Final Goodbye: the cremation steps only, until their own are defined.
    const [direct, viewing, goodbye] = result.templates!;
    expect(JSON.stringify(viewing.versions[0].stages)).toBe(JSON.stringify(direct.versions[0].stages));
    expect(JSON.stringify(goodbye.versions[0].stages)).toBe(JSON.stringify(direct.versions[0].stages));
    expect(JSON.stringify(workflowTemplateFixtures.filter((t) => t.organizationId !== GUS))).toBe(othersBefore);
    const gusTemplates = workflowTemplateFixtures.filter((t) => t.organizationId === GUS);
    expect(selectWorkflowTemplate(gusTemplates, GUS, 'CREMATION_WITH_VIEWING').ok).toBe(true);
    expect(selectWorkflowTemplate(gusTemplates, GUS, 'DIRECT_ENTOMBMENT')).toMatchObject({ ok: false, reason: 'not_approved' });
    // The burial/entombment drafts carry no crematory or cremated-remains step.
    const entombment = result.templates![5].versions[0];
    expect(findStep(entombment.stages, CREMATION_STEPS.permitSent)).toBeNull();
    expect(findStep(entombment.stages, CREMATION_STEPS.remainsReceived)).toBeNull();
    expect(findStep(entombment.stages, CREMATION_STEPS.edrsSubmitted)).not.toBeNull();
    expect((await getOrganizationWorkflow(GUS, 'mock'))?.id).toBe(result.template.id);
  });

  it('is idempotent per service — a retry creates nothing and never overwrites an edited template', async () => {
    await provisionWorkflow(GUS, { mode: 'service_workflows' }, ids(), 'mock');
    const viewing = workflowTemplateFixtures.find((t) => t.organizationId === GUS && t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!;
    viewing.description = 'Edited by an administrator';
    const snapshot = JSON.stringify(workflowTemplateFixtures);

    const factory = vi.fn(() => 'should-not-be-used');
    const retry = await provisionWorkflow(GUS, { mode: 'service_workflows' }, factory, 'mock');
    expect(retry.isNew).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(JSON.stringify(workflowTemplateFixtures)).toBe(snapshot);
  });

  it('refuses an organization that does not choose workflows by service (Manors)', async () => {
    await expect(provisionWorkflow('managed-cremations', { mode: 'service_workflows' }, ids(), 'mock')).rejects.toThrow(/chooses workflows by service/);
  });
});
