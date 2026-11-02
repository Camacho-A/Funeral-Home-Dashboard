import { describe, expect, it } from 'vitest';
import {
  isWorkflowApprovalRequired,
  isWorkflowByServiceType,
  notApprovedWorkflowMessage,
  selectWorkflowTemplate,
} from './selectWorkflowTemplate';
import { buildCaseWorkflowSnapshot, latestApprovedVersion, latestTemplateVersion } from './snapshot';
import { GUS_SERVICE_CATALOG, GUS_SERVICE_CODES } from '../onboarding/gusServiceCatalog';
import {
  buildGusServiceWorkflowTemplateFixtures,
  secondOrgWorkflowTemplateFixture,
  standardCremationWorkflowTemplateFixture,
  GUS_WORKFLOW_TEMPLATE_ID,
} from '../../services/__mocks__/workflowTemplates';
import type { WorkflowTemplate } from '../../types/workflowTemplate';

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';
const EVERGREEN = 'evergreen-memorial-group';

const options = {
  activeServiceTypeCodes: GUS_SERVICE_CATALOG.map((entry) => entry.serviceCode),
  serviceDisplayName: (code: string) => GUS_SERVICE_CATALOG.find((entry) => entry.serviceCode === code)?.displayName,
};

describe('profile flags', () => {
  it('only Gus selects workflows by service type and requires approval', () => {
    expect(isWorkflowByServiceType(GUS)).toBe(true);
    expect(isWorkflowApprovalRequired(GUS)).toBe(true);
    for (const org of [MANORS, EVERGREEN, 'unknown-org', null]) {
      expect(isWorkflowByServiceType(org)).toBe(false);
      expect(isWorkflowApprovalRequired(org)).toBe(false);
    }
  });
});

describe('selectWorkflowTemplate — organizations without service workflows (unchanged)', () => {
  it('Manors: exactly the first enabled template at its latest version, whatever service is named', () => {
    const templates = [standardCremationWorkflowTemplateFixture];
    for (const code of [undefined, null, 'DIRECT_CREMATION', 'anything']) {
      const result = selectWorkflowTemplate(templates, MANORS, code);
      expect(result).toEqual({
        ok: true,
        template: templates.find((t) => t.isEnabled),
        version: latestTemplateVersion(standardCremationWorkflowTemplateFixture),
        serviceTypeCode: null,
      });
    }
  });

  it('evergreen: same rule; no enabled template is refused with the historical message', () => {
    expect(selectWorkflowTemplate([secondOrgWorkflowTemplateFixture], EVERGREEN, null)).toMatchObject({
      ok: true,
      template: secondOrgWorkflowTemplateFixture,
    });
    const disabled = { ...secondOrgWorkflowTemplateFixture, isEnabled: false };
    expect(selectWorkflowTemplate([disabled], EVERGREEN, null)).toEqual({
      ok: false,
      reason: 'no_enabled_template',
      message: 'No enabled workflow template found for this organization.',
    });
  });

  it('a snapshot built without a service type is byte-identical to before (no serviceTypeCode key)', () => {
    const version = latestTemplateVersion(standardCremationWorkflowTemplateFixture);
    const snapshot = buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, version);
    expect(Object.keys(snapshot).sort()).toEqual(['intake', 'stages', 'workflowTemplateId', 'workflowTemplateVersion']);
  });
});

describe('selectWorkflowTemplate — Gus (one workflow per service type)', () => {
  const templates = buildGusServiceWorkflowTemplateFixtures();

  it('Direct Cremation selects its approved workflow and records the service on the snapshot', () => {
    const result = selectWorkflowTemplate(templates, GUS, GUS_SERVICE_CODES.DIRECT_CREMATION, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.template.id).toBe(GUS_WORKFLOW_TEMPLATE_ID);
    // The shared-foundation version (v2) — v1 stays for earlier demo cases.
    expect(result.version.version).toBe(2);
    expect(buildCaseWorkflowSnapshot(result.template, result.version, result.serviceTypeCode).serviceTypeCode).toBe('DIRECT_CREMATION');
  });

  it.each([GUS_SERVICE_CODES.CREMATION_WITH_VIEWING, GUS_SERVICE_CODES.CREMATION_WITH_FINAL_GOODBYE])(
    '%s uses the shared cremation process, approved (its own steps are still to be defined)',
    (code) => {
      const result = selectWorkflowTemplate(templates, GUS, code, options);
      expect(result).toMatchObject({ ok: true, serviceTypeCode: code });
    },
  );

  it.each(GUS_SERVICE_CATALOG.slice(3).map((entry) => [entry.serviceCode, entry.displayName]))(
    '%s is refused until its draft workflow is approved',
    (code, name) => {
      const result = selectWorkflowTemplate(templates, GUS, code, options);
      expect(result).toEqual({ ok: false, reason: 'not_approved', message: notApprovedWorkflowMessage(name) });
    },
  );

  it('the refusal names the service and says where to approve it', () => {
    const result = selectWorkflowTemplate(templates, GUS, GUS_SERVICE_CODES.DIRECT_ENTOMBMENT, options);
    expect(result.ok ? null : result.message).toBe(
      'The workflow for Direct Entombment (Embalming Required) has not been approved yet. An administrator must review and approve it in Settings › Workflow Templates before cases can use it.',
    );
  });

  it('requires a service type — never a guess', () => {
    for (const code of [undefined, null, '', '   ']) {
      expect(selectWorkflowTemplate(templates, GUS, code, options)).toMatchObject({ ok: false, reason: 'service_type_required' });
    }
  });

  it("refuses a code outside the organization's active service types (server-side validation)", () => {
    expect(selectWorkflowTemplate(templates, GUS, 'BASE_CREMATION', options)).toMatchObject({ ok: false, reason: 'unknown_service_type' });
    expect(
      selectWorkflowTemplate(templates, GUS, 'DIRECT_CREMATION', { ...options, activeServiceTypeCodes: ['CREMATION_WITH_VIEWING'] }),
    ).toMatchObject({ ok: false, reason: 'unknown_service_type' });
  });

  it('once a draft is approved, its latest APPROVED version is used — never a newer draft', () => {
    const approved: WorkflowTemplate[] = structuredClone(templates);
    const viewing = approved.find((t) => t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!;
    viewing.versions[0].status = 'approved';
    viewing.versions.push({ ...structuredClone(viewing.versions[0]), version: 2, status: 'draft' });
    const result = selectWorkflowTemplate(approved, GUS, 'CREMATION_WITH_VIEWING', options);
    expect(result).toMatchObject({ ok: true, template: { id: viewing.id }, version: { version: 1 } });
    expect(latestApprovedVersion(viewing)?.version).toBe(1);
  });

  it('ignores disabled templates and other organizations; refuses two templates for one service', () => {
    const disabled = templates.map((t) => (t.id === GUS_WORKFLOW_TEMPLATE_ID ? { ...t, isEnabled: false } : t));
    expect(selectWorkflowTemplate(disabled, GUS, 'DIRECT_CREMATION', options)).toMatchObject({ ok: false, reason: 'no_template_for_service' });

    const foreign = templates.map((t) => ({ ...t, organizationId: MANORS }));
    expect(selectWorkflowTemplate(foreign, GUS, 'DIRECT_CREMATION', options)).toMatchObject({ ok: false, reason: 'no_template_for_service' });

    const duplicate = [...templates, { ...templates[0], id: 'second-direct-cremation' }];
    expect(selectWorkflowTemplate(duplicate, GUS, 'DIRECT_CREMATION', options)).toMatchObject({
      ok: false,
      reason: 'ambiguous_service_template',
    });
  });
});
