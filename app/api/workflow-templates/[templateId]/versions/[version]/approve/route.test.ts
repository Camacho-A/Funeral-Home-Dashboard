import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, MANORS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/identityFixtures';
import { GUS_ADMIN_IDENTITY_ID, GUS_DIRECTOR_IDENTITY_ID } from '@/services/__mocks__/gusFixtures';
import {
  workflowTemplateFixtures,
  GUS_WORKFLOW_TEMPLATE_ID,
  STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID,
} from '@/services/__mocks__/workflowTemplates';
import { selectWorkflowTemplate } from '@/domain/workflow/selectWorkflowTemplate';
import { addChecklistItem, updateStage } from '@/domain/workflow/templateEditing';
import { completionItemOptions, finalItemsCompletionPolicy } from '@/domain/workflow/completionPolicy';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import type { WorkflowTemplate } from '@/types/workflowTemplate';

/** Unfinished-workflow protection (2026-10): every approval now carries the
    approver's review attestation (see approve/route.ts). */
const REVIEW_ATTESTATION = { stagesReviewed: true, checklistReviewed: true, completionReviewed: true };

/**
 * Service-specific workflows (2026-10). Approval of draft workflow
 * versions, and draft-by-default version saves for Gus — mock data only.
 */

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: vi.fn(async () => undefined),
  clearSession: vi.fn(),
}));

const { createIdentitySession } = await import('@/services/sessionService');
const approve = await import('./route');
const versions = await import('../../route');

let n = 0;
async function signInAs(identityId: string) {
  const identity = identityFixtures.find((i) => i.id === identityId)!;
  const session = await createIdentitySession(
    { identityId, deviceId: 'approve-route-test', passwordVersionAtIssue: identity.passwordVersion, idFactory: () => `ap-${++n}` },
    'mock',
  );
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
}

function postApprove(templateId: string, version: number | string, organizationId: string) {
  return approve.POST(
    new Request(`http://localhost/api/workflow-templates/${templateId}/versions/${version}/approve`, {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({ organizationId, attestation: REVIEW_ATTESTATION }),
    }),
    { params: Promise.resolve({ templateId, version: String(version) }) },
  );
}

function gusTemplate(code: string): WorkflowTemplate {
  return workflowTemplateFixtures.find((t) => t.organizationId === GUS && t.serviceTypeCodes?.includes(code))!;
}

let templatesBefore: WorkflowTemplate[];

beforeEach(async () => {
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  templatesBefore = structuredClone(workflowTemplateFixtures);
  await signInAs(GUS_ADMIN_IDENTITY_ID);
});

afterEach(() => {
  workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...templatesBefore);
});

describe('POST /api/workflow-templates/[templateId]/versions/[version]/approve', () => {
  it('approves a Gus draft; new cases then use it (until then, the approved version)', async () => {
    const viewing = gusTemplate('CREMATION_WITH_VIEWING');
    const gusTemplates = () => workflowTemplateFixtures.filter((t) => t.organizationId === GUS);
    expect(selectWorkflowTemplate(gusTemplates(), GUS, 'CREMATION_WITH_VIEWING')).toMatchObject({ ok: true, version: { version: 1 } });

    // An edit (a fictional extra step) is saved as a draft…
    const v1 = viewing.versions[0];
    const owned = addChecklistItem(v1.stages, 5, 'Example service-specific step');
    const saved = await versions.POST(
      new Request(`http://localhost/api/workflow-templates/${viewing.id}/versions`, {
        method: 'POST',
        headers: { origin: 'http://localhost', host: 'localhost' },
        body: JSON.stringify({ organizationId: GUS, stages: owned, intake: v1.intake }),
      }),
      { params: Promise.resolve({ templateId: viewing.id }) },
    );
    expect(saved.status).toBe(200);
    expect(selectWorkflowTemplate(gusTemplates(), GUS, 'CREMATION_WITH_VIEWING')).toMatchObject({ ok: true, version: { version: 1 } });

    // …and only approval puts it in front of new cases.
    const response = await postApprove(viewing.id, 2, GUS);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workflowTemplate.versions[1]).toMatchObject({ status: 'approved', approvedBy: GUS_ADMIN_IDENTITY_ID });
    expect(typeof body.workflowTemplate.versions[1].approvedAt).toBe('string');
    // Content is untouched by approval.
    expect(gusTemplate('CREMATION_WITH_VIEWING').versions[1].stages).toEqual(owned);
    expect(selectWorkflowTemplate(gusTemplates(), GUS, 'CREMATION_WITH_VIEWING')).toMatchObject({ ok: true, template: { id: viewing.id }, version: { version: 2 } });
  });

  it('refuses an already-approved version (409) and changes nothing', async () => {
    const response = await postApprove(GUS_WORKFLOW_TEMPLATE_ID, 1, GUS);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already approved/);
    expect(workflowTemplateFixtures).toEqual(templatesBefore);
  });

  it('404 for an unknown version or another organization’s template; 400 for a malformed version', async () => {
    expect((await postApprove(GUS_WORKFLOW_TEMPLATE_ID, 99, GUS)).status).toBe(404);
    expect((await postApprove(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, 1, GUS)).status).toBe(404);
    expect((await postApprove(GUS_WORKFLOW_TEMPLATE_ID, 'x', GUS)).status).toBe(400);
    expect(workflowTemplateFixtures).toEqual(templatesBefore);
  });

  it('requires workflow.publish — a funeral director is refused (403)', async () => {
    await signInAs(GUS_DIRECTOR_IDENTITY_ID);
    const response = await postApprove(gusTemplate('DIRECT_ENTOMBMENT').id, 1, GUS);
    expect(response.status).toBe(403);
    expect(workflowTemplateFixtures).toEqual(templatesBefore);
  });

  it('Manors has no approval step (403) and is unchanged', async () => {
    await signInAs(MANORS_ADMIN_IDENTITY_ID);
    const response = await postApprove(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, 1, MANORS);
    expect(response.status).toBe(403);
    expect(workflowTemplateFixtures).toEqual(templatesBefore);
  });
});

describe('POST /api/workflow-templates/[templateId]/versions — drafts for organizations requiring approval', () => {
  function saveVersion(templateId: string, organizationId: string, from: WorkflowTemplate) {
    const latest = from.versions[from.versions.length - 1];
    return versions.POST(
      new Request(`http://localhost/api/workflow-templates/${templateId}/versions`, {
        method: 'POST',
        headers: { origin: 'http://localhost', host: 'localhost' },
        body: JSON.stringify({ organizationId, stages: latest.stages, intake: latest.intake }),
      }),
      { params: Promise.resolve({ templateId }) },
    );
  }

  it('a Gus edit is saved as a DRAFT; cases keep using the approved version', async () => {
    const direct = workflowTemplateFixtures.find((t) => t.id === GUS_WORKFLOW_TEMPLATE_ID)!;
    const response = await saveVersion(GUS_WORKFLOW_TEMPLATE_ID, GUS, direct);
    expect(response.status).toBe(200);
    const body = await response.json();
    // v1 (before approvals existed — absent = approved), v2 (the shared foundation), the new draft.
    expect(body.workflowTemplate.versions.map((v: { status?: string }) => v.status)).toEqual([undefined, 'approved', 'draft']);
    const selection = selectWorkflowTemplate(workflowTemplateFixtures.filter((t) => t.organizationId === GUS), GUS, 'DIRECT_CREMATION');
    expect(selection).toMatchObject({ ok: true, version: { version: 2 } });
  });

  it('a Manors edit has no status at all (unchanged behavior)', async () => {
    await signInAs(MANORS_ADMIN_IDENTITY_ID);
    const manors = workflowTemplateFixtures.find((t) => t.id === STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID)!;
    const response = await saveVersion(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, MANORS, manors);
    expect(response.status).toBe(200);
    const body = await response.json();
    const latest = body.workflowTemplate.versions[body.workflowTemplate.versions.length - 1];
    expect('status' in latest).toBe(false);
  });
});

describe('unfinished-workflow protection (2026-10)', () => {
  let eventsBefore: number;
  beforeEach(() => {
    eventsBefore = activityEventFixtures.length;
  });
  afterEach(() => {
    activityEventFixtures.splice(eventsBefore);
  });

  function postWith(templateId: string, version: number, body: Record<string, unknown>) {
    return approve.POST(
      new Request(`http://localhost/api/workflow-templates/${templateId}/versions/${version}/approve`, {
        method: 'POST',
        headers: { origin: 'http://localhost', host: 'localhost' },
        body: JSON.stringify({ organizationId: GUS, ...body }),
      }),
      { params: Promise.resolve({ templateId, version: String(version) }) },
    );
  }
  function saveDraft(templateId: string, body: Record<string, unknown>) {
    return versions.POST(
      new Request(`http://localhost/api/workflow-templates/${templateId}/versions`, {
        method: 'POST',
        headers: { origin: 'http://localhost', host: 'localhost' },
        body: JSON.stringify({ organizationId: GUS, ...body }),
      }),
      { params: Promise.resolve({ templateId }) },
    );
  }
  const refusals = () => activityEventFixtures.slice(eventsBefore).filter((e) => e.eventType === 'workflow.template.approval_refused');

  it('requires the full review attestation (422), before looking at the content — and audits the refusal', async () => {
    const viewing = gusTemplate('CREMATION_WITH_VIEWING');
    expect((await saveDraft(viewing.id, { stages: viewing.versions[0].stages, intake: viewing.versions[0].intake })).status).toBe(200);
    const draftsSaved = structuredClone(workflowTemplateFixtures);
    for (const attestation of [undefined, { stagesReviewed: true, checklistReviewed: true }, { ...REVIEW_ATTESTATION, completionReviewed: 'yes' }]) {
      const response = await postWith(viewing.id, 2, attestation ? { attestation } : {});
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.problems.map((p: { code: string }) => p.code)).toEqual(['attestation_missing']);
      expect(body.error).toMatch(/stages, the checklist items and the completion rules have been reviewed/);
    }
    expect(workflowTemplateFixtures).toEqual(draftsSaved);
    expect(refusals()).toHaveLength(3);
    expect(refusals()[0]).toMatchObject({ resourceId: viewing.id, actorIdentityId: GUS_ADMIN_IDENTITY_ID, severity: 'warning', caseId: null });
    expect(JSON.parse(refusals()[0].metadata!)).toMatchObject({ codes: ['attestation_missing'] });
  });

  it.each(['CREMATION_WITH_FINAL_GOODBYE', 'CREMATION_WITH_VIEWING'])(
    '%s may match Direct Cremation — both are the shared cremation process (2026-11) — so a reviewed draft is approved',
    async (code) => {
      const template = gusTemplate(code);
      expect((await saveDraft(template.id, { stages: template.versions[0].stages, intake: template.versions[0].intake })).status).toBe(200);
      const response = await postApprove(template.id, 2, GUS);
      expect(response.status).toBe(200);
      expect(refusals()).toEqual([]);
    },
  );

  it('a hand-made copy of Direct Cremation (not built from the shared foundation) is still refused until it is made its own', async () => {
    const direct = gusTemplate('DIRECT_CREMATION');
    const directLatest = direct.versions[direct.versions.length - 1];
    const copy: WorkflowTemplate = {
      id: 'workflow-template-fictional-copy',
      organizationId: GUS,
      name: 'Fictional copied service',
      isEnabled: true,
      caseTypes: ['cremation'],
      serviceTypeCodes: [],
      versions: [
        {
          ...structuredClone(directLatest),
          version: 1,
          status: 'draft',
          serviceTypeCodes: undefined,
          composition: undefined,
          derivedFrom: { templateId: direct.id, version: directLatest.version },
        },
      ],
    };
    workflowTemplateFixtures.push(copy);
    const response = await postApprove(copy.id, 1, GUS);
    expect(response.status).toBe(422);
    expect((await response.json()).details).toContain('This workflow is still an unmodified copy of Direct Cremation; define the service-specific steps before approval.');
    expect(refusals().map((e) => JSON.parse(e.metadata!).codes[0])).toEqual(['unmodified_copy']);
  });

  it('refuses a burial/entombment placeholder stage even once an item is added, and an undefined completion policy', async () => {
    for (const code of ['GRAVESIDE_BURIAL_SERVICE_ONLY', 'VETERANS_GRAVESIDE_BURIAL_SERVICE_ONLY', 'DIRECT_ENTOMBMENT']) {
      const template = gusTemplate(code);
      const v1 = template.versions[0];
      const placeholder = v1.stages.find((s) => s.label.endsWith('steps to be defined'))!;
      const stages = addChecklistItem(v1.stages, placeholder.displayStage, 'Example step');
      expect((await saveDraft(template.id, { stages, intake: v1.intake })).status).toBe(200);
      const response = await postApprove(template.id, 2, GUS);
      expect(response.status).toBe(422);
      expect((await response.json()).problems.map((p: { code: string }) => p.code)).toEqual(['placeholder_stage', 'completion_items_undefined']);
      expect(gusTemplate(code).versions.every((v) => v.status === 'draft')).toBe(true);
    }
  });

  it('a burial defined by its administrator — named stage, chosen completion item — is approved; the event records the attestation and the policy', async () => {
    const graveside = gusTemplate('GRAVESIDE_BURIAL_SERVICE_ONLY');
    const v1 = graveside.versions[0];
    const position = v1.stages.find((s) => s.label.endsWith('steps to be defined'))!.displayStage;
    const stages = addChecklistItem(updateStage(v1.stages, position, { label: 'Example graveside stage' }), position, 'Example final step');
    const completionPolicy = finalItemsCompletionPolicy({ requiredFinalItems: [completionItemOptions(stages).find((o) => o.ref.label === 'Example final step')!.ref] });
    expect((await saveDraft(graveside.id, { stages, intake: v1.intake, completionPolicy })).status).toBe(200);

    const response = await postApprove(graveside.id, 2, GUS);
    expect(response.status).toBe(200);
    expect(gusTemplate('GRAVESIDE_BURIAL_SERVICE_ONLY').versions[1]).toMatchObject({ status: 'approved', completionPolicy });
    const published = activityEventFixtures.slice(eventsBefore).find((e) => e.eventType === 'workflow.template.published')!;
    expect(JSON.parse(published.metadata!)).toEqual({ templateName: graveside.name, attestation: REVIEW_ATTESTATION, completionPolicy });
    expect(refusals()).toEqual([]);
  });
});
