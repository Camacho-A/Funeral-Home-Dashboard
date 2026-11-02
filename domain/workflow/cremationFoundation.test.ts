import { describe, expect, it } from 'vitest';
import type { StageTemplate, WorkflowTemplate } from '../../types/workflowTemplate';
import { buildCremationFoundationStages, CREMATION_STEP_IDS, CREMATION_STEPS } from './cremationFoundation';
import { composeWorkflowStages, WorkflowCompositionError, type WorkflowExtension } from './workflowComposition';
import {
  buildServiceWorkflowVersion,
  CREMATION_SERVICE_WORKFLOWS,
  foundationOptionsFor,
} from './serviceWorkflows';
import { isWorkflowByServiceType, selectWorkflowTemplate } from './selectWorkflowTemplate';
import { findStep } from './workflowSteps';
import { buildCaseWorkflowSnapshot } from './snapshot';
import { standardCremationWorkflowTemplateFixture, CERTIFIER_FAX_REQUIRED_CASE_FIELDS, workflowTemplateFixtures } from '../../services/__mocks__/workflowTemplates';
import { JOTFORM_INTEGRATION_ID } from '../../services/__mocks__/externalFormIntegrations';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';

/**
 * Shared cremation foundation (2026-11): one definition of the cremation
 * process, proven identical to the Manors process, with services that only
 * ever add to it.
 */

const withoutIds = (stages: StageTemplate[]) =>
  stages.map((stage) => {
    const copy: StageTemplate = { ...stage, checklist: { items: stage.checklist.items.map((item) => { const c = { ...item }; delete c.stepId; return c; }) } };
    delete copy.stageKey;
    return copy;
  });

const manorsV7 = standardCremationWorkflowTemplateFixture.versions.find((v) => v.version === 7)!;
const foundation = buildCremationFoundationStages({ arrangementFormIntegrationId: null });

describe('the cremation foundation IS the Manors cremation process', () => {
  it('with Manors’ own settings it is item-for-item the Manors workflow (template v7) — same stages, labels, order, rules', () => {
    const asManors = buildCremationFoundationStages({ arrangementFormIntegrationId: JOTFORM_INTEGRATION_ID, certifierRequiredCaseFields: CERTIFIER_FAX_REQUIRED_CASE_FIELDS });
    expect(withoutIds(asManors)).toEqual(manorsV7.stages);
  });

  it('only organization choices differ: the arrangement-form fulfilment and the certifier fields', () => {
    const differences: string[] = [];
    const asManors = buildCremationFoundationStages({ arrangementFormIntegrationId: JOTFORM_INTEGRATION_ID, certifierRequiredCaseFields: CERTIFIER_FAX_REQUIRED_CASE_FIELDS });
    asManors.forEach((stage, s) =>
      stage.checklist.items.forEach((item, i) => {
        if (JSON.stringify(item) !== JSON.stringify(foundation[s].checklist.items[i])) differences.push(item.stepId!);
      }),
    );
    expect([...new Set(differences)].sort()).toEqual([CREMATION_STEPS.arrangementFormCompleted, 'cremation.first_call.certifier']);
    expect(foundation.flatMap((s) => s.checklist.items).find((i) => i.stepId === 'cremation.first_call.certifier')?.requiredCaseFields).toEqual(['certifierName', 'certifierPhone']);
  });

  it('the certifier requirement is each organization\'s own setting: Gus and Manors need name + fax, others the platform default', () => {
    const certifierOf = (orgId: string) =>
      buildCremationFoundationStages(foundationOptionsFor(orgId, { arrangementFormIntegrationId: null }))
        .flatMap((s) => s.checklist.items)
        .find((i) => i.stepId === 'cremation.first_call.certifier')?.requiredCaseFields;
    expect(certifierOf(GUS_CAMACHO_ORGANIZATION_ID)).toEqual(['certifierName', 'certifierFax']);
    expect(certifierOf(MANORS_ORGANIZATION_ID)).toEqual(CERTIFIER_FAX_REQUIRED_CASE_FIELDS);
    expect(certifierOf('some-future-funeral-home')).toEqual(['certifierName', 'certifierPhone']);
    // Gus's own service workflows are built with it.
    const gusDirect = workflowTemplateFixtures.find((t) => t.organizationId === GUS_CAMACHO_ORGANIZATION_ID && t.name === 'Direct Cremation')!;
    const certifier = gusDirect.versions.at(-1)!.stages.flatMap((s) => s.checklist.items).find((i) => i.stepId === 'cremation.first_call.certifier');
    expect(certifier?.requiredCaseFields).toEqual(['certifierName', 'certifierFax']);
  });

  it('every stage and every item has a stable id, unique per display stage', () => {
    for (const stage of foundation) {
      expect(stage.stageKey).toMatch(/^cremation\./);
      for (const item of stage.checklist.items) expect(item.stepId).toBe(CREMATION_STEP_IDS[stage.displayStage][item.index]);
    }
    const ids = new Set<string>();
    for (const displayStage of new Set(foundation.map((s) => s.displayStage))) {
      for (const item of foundation.find((s) => s.displayStage === displayStage)!.checklist.items) {
        expect(ids.has(item.stepId!)).toBe(false);
        ids.add(item.stepId!);
      }
    }
    expect(findStep(foundation, CREMATION_STEPS.permitSent)).toEqual({ displayStage: 3, index: 0 });
    expect(findStep(foundation, CREMATION_STEPS.authorizationSent)).toEqual({ displayStage: 3, index: 1 });
  });

  it('carries no organization data — no recipients, prices, forms or names', () => {
    expect(JSON.stringify(foundation)).not.toMatch(/manors|gus|@|\$|jotform-integration/i);
  });
});

describe('services extend the foundation — they never replace or repeat it', () => {
  const extra: WorkflowExtension = {
    key: 'test.service',
    version: 1,
    label: 'Test service',
    stepsToBeDefined: false,
    additions: [
      { kind: 'items', stageKey: 'cremation.remains', items: [{ stepId: 'test.service.memorial_card', label: 'Memorial card printed' }] },
      { kind: 'stage', beforeStageKey: 'cremation.complete', stage: { stageKey: 'test.service.gathering', label: 'Family gathering', slaTargetDays: null, items: [{ stepId: 'test.service.gathering_held', label: 'Gathering held' }] } },
    ],
  };

  it('added items go after the base items; every base item keeps its storage index', () => {
    const composed = composeWorkflowStages(foundation, [extra]);
    const remains = composed.find((s) => s.stageKey === 'cremation.remains')!;
    expect(remains.checklist.items.slice(0, 6)).toEqual(foundation.find((s) => s.stageKey === 'cremation.remains')!.checklist.items);
    expect(remains.checklist.items[6]).toMatchObject({ index: 6, stepId: 'test.service.memorial_card', label: 'Memorial card printed' });
  });

  it('an added stage goes where asked and the stages after it move along; every base step is still there, in order', () => {
    const composed = composeWorkflowStages(foundation, [extra]);
    expect(composed.map((s) => s.label).slice(-2)).toEqual(['Family gathering', 'Completed']);
    expect(composed.at(-1)!.displayStage).toBe(foundation.at(-1)!.displayStage + 1);
    const baseSteps = (stages: StageTemplate[]) => stages.flatMap((s) => s.checklist.items.map((i) => i.stepId)).filter((id) => id?.startsWith('cremation.'));
    expect(baseSteps(composed)).toEqual(baseSteps(foundation));
    expect(findStep(composed, CREMATION_STEPS.permitSent)).toEqual({ displayStage: 3, index: 0 });
  });

  it('the foundation itself is never modified', () => {
    const before = structuredClone(foundation);
    composeWorkflowStages(foundation, [extra]);
    expect(foundation).toEqual(before);
  });

  it('a step defined twice, or added to a stage that does not exist, is refused', () => {
    expect(() => composeWorkflowStages(foundation, [extra, extra])).toThrow(WorkflowCompositionError);
    expect(() =>
      composeWorkflowStages(foundation, [{ ...extra, additions: [{ kind: 'items', stageKey: 'nowhere', items: [{ stepId: 'x.y', label: 'Y' }] }] }]),
    ).toThrow(/no stage "nowhere"/);
    expect(() =>
      composeWorkflowStages(foundation, [{ ...extra, additions: [{ kind: 'items', stageKey: 'cremation.edrs', items: [{ stepId: CREMATION_STEPS.permitSent, label: 'Dup' }] }] }]),
    ).toThrow(/defined twice/);
  });
});

describe("Gus's three cremation services", () => {
  const version = (code: keyof typeof CREMATION_SERVICE_WORKFLOWS) =>
    buildServiceWorkflowVersion({ definition: CREMATION_SERVICE_WORKFLOWS[code], foundation: { arrangementFormIntegrationId: null }, intake: manorsV7.intake, version: 1, createdAt: '2026-11-01T00:00:00.000Z' });

  it('Direct Cremation is the foundation; Viewing and Final Goodbye are the foundation plus their (not yet defined) steps', () => {
    expect(version('DIRECT_CREMATION').stages).toEqual(foundation);
    expect(version('CREMATION_WITH_VIEWING').stages).toEqual(foundation);
    expect(version('CREMATION_WITH_FINAL_GOODBYE').stages).toEqual(foundation);
    expect(CREMATION_SERVICE_WORKFLOWS.CREMATION_WITH_VIEWING.extensions.every((e) => e.stepsToBeDefined && e.additions.length === 0)).toBe(true);
    expect(CREMATION_SERVICE_WORKFLOWS.CREMATION_WITH_FINAL_GOODBYE.extensions.every((e) => e.stepsToBeDefined && e.additions.length === 0)).toBe(true);
  });

  it('each version records its service and what it was built from', () => {
    expect(version('DIRECT_CREMATION')).toMatchObject({ serviceTypeCodes: ['DIRECT_CREMATION'], composition: { base: { key: 'cremation.base', version: 1 }, extensions: [] } });
    expect(version('CREMATION_WITH_VIEWING').composition?.extensions).toEqual([{ key: 'service.viewing', version: 1 }]);
    expect(version('CREMATION_WITH_FINAL_GOODBYE').composition?.extensions).toEqual([{ key: 'service.final_goodbye', version: 1 }]);
  });
});

describe('choosing the workflow for a new case', () => {
  const gusTemplates = workflowTemplateFixtures.filter((t) => t.organizationId === GUS_CAMACHO_ORGANIZATION_ID);
  const manorsTemplates = workflowTemplateFixtures.filter((t) => t.organizationId === MANORS_ORGANIZATION_ID);

  it('Manors keeps "first enabled template, latest version", whatever is passed', () => {
    expect(isWorkflowByServiceType(MANORS_ORGANIZATION_ID)).toBe(false);
    for (const serviceTypeCode of [undefined, null, 'CREMATION_WITH_VIEWING']) {
      const selection = selectWorkflowTemplate(manorsTemplates, MANORS_ORGANIZATION_ID, serviceTypeCode);
      expect(selection).toMatchObject({ ok: true, template: { id: 'workflow-template-standard-cremation' }, version: { version: 7 }, serviceTypeCode: null });
    }
  });

  it('Gus must name a service, gets that service’s template, and a service without one is refused', () => {
    expect(isWorkflowByServiceType(GUS_CAMACHO_ORGANIZATION_ID)).toBe(true);
    expect(selectWorkflowTemplate(gusTemplates, GUS_CAMACHO_ORGANIZATION_ID, null)).toMatchObject({ ok: false, reason: 'service_type_required' });
    expect(selectWorkflowTemplate(gusTemplates, GUS_CAMACHO_ORGANIZATION_ID, 'DIRECT_ENTOMBMENT')).toMatchObject({ ok: false, reason: 'not_approved' });
    expect(selectWorkflowTemplate(gusTemplates, GUS_CAMACHO_ORGANIZATION_ID, 'DIRECT_BURIAL')).toMatchObject({ ok: false, reason: 'no_template_for_service' });
    const viewing = selectWorkflowTemplate(gusTemplates, GUS_CAMACHO_ORGANIZATION_ID, 'CREMATION_WITH_VIEWING');
    expect(viewing).toMatchObject({ ok: true, template: { name: 'Cremation with Viewing' }, serviceTypeCode: 'CREMATION_WITH_VIEWING' });
  });

  it('two templates claiming one service is refused rather than guessed', () => {
    const dup = structuredClone(gusTemplates[0]) as WorkflowTemplate;
    dup.id = 'duplicate';
    expect(selectWorkflowTemplate([...gusTemplates, dup], GUS_CAMACHO_ORGANIZATION_ID, 'DIRECT_CREMATION')).toMatchObject({ ok: false, reason: 'ambiguous_service_template' });
  });

  it('a disabled template is not used, and a draft version is never used for a case', () => {
    const disabled = gusTemplates.map((t) => (t.name === 'Cremation with Viewing' ? { ...t, isEnabled: false } : t));
    expect(selectWorkflowTemplate(disabled, GUS_CAMACHO_ORGANIZATION_ID, 'CREMATION_WITH_VIEWING')).toMatchObject({ ok: false, reason: 'no_template_for_service' });
    const goodbye = structuredClone(gusTemplates.find((t) => t.name === 'Cremation with Final Goodbye')!) as WorkflowTemplate;
    const approved = goodbye.versions.at(-1)!.version;
    goodbye.versions.push({ ...structuredClone(goodbye.versions.at(-1)!), version: approved + 1, status: 'draft' });
    const others = gusTemplates.filter((t) => t.id !== goodbye.id);
    expect(selectWorkflowTemplate([...others, goodbye], GUS_CAMACHO_ORGANIZATION_ID, 'CREMATION_WITH_FINAL_GOODBYE')).toMatchObject({ ok: true, version: { version: approved } });
  });

  it('the case snapshot records the service and composition — and a Manors snapshot is exactly as before', () => {
    const gus = gusTemplates.find((t) => t.name === 'Cremation with Final Goodbye')!;
    const snap = buildCaseWorkflowSnapshot(gus, gus.versions.at(-1)!, 'CREMATION_WITH_FINAL_GOODBYE');
    expect(snap.serviceTypeCode).toBe('CREMATION_WITH_FINAL_GOODBYE');
    expect(snap.composition?.extensions).toEqual([{ key: 'service.final_goodbye', version: 1 }]);
    const manors = buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, manorsV7, null);
    expect(Object.keys(manors).sort()).toEqual(['intake', 'stages', 'workflowTemplateId', 'workflowTemplateVersion']);
  });
});
