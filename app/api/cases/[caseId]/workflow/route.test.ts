import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, MANORS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/identityFixtures';
import { GUS_ADMIN_IDENTITY_ID, GUS_VIEWER_IDENTITY_ID } from '@/services/__mocks__/gusFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { workflowTemplateFixtures, GUS_WORKFLOW_TEMPLATE_ID } from '@/services/__mocks__/workflowTemplates';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import type { Case } from '@/types/case';
import type { WorkflowTemplate } from '@/types/workflowTemplate';

/**
 * Service-specific workflows (2026-10). POST /api/cases/[caseId]/workflow —
 * mock data only (fictional cases), never Wix/network.
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
const { POST } = await import('./route');

let n = 0;
async function signInAs(identityId: string) {
  const identity = identityFixtures.find((i) => i.id === identityId)!;
  const session = await createIdentitySession(
    { identityId, deviceId: 'workflow-route-test', passwordVersionAtIssue: identity.passwordVersion, idFactory: () => `wf-${++n}` },
    'mock',
  );
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
}

function post(caseId: string, body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/cases/${caseId}/workflow`, {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify('expectedRevision' in body ? body : { ...body, expectedRevision: (caseFixtures.find((c) => c.id === caseId)?.revision ?? 0) }),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}

let casesBefore: Case[];
let templatesBefore: WorkflowTemplate[];
let activityCountBefore: number;

function gusCase(rawStage: number): Case {
  return caseFixtures.find((c) => c.organizationId === GUS && c.rawStage === rawStage)!;
}

/** Approves Gus' Cremation with Viewing draft for the test (fictional). */
function approveViewing() {
  const viewing = workflowTemplateFixtures.find((t) => t.organizationId === GUS && t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!;
  viewing.versions[0].status = 'approved';
  return viewing;
}

beforeEach(async () => {
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  casesBefore = structuredClone(caseFixtures);
  templatesBefore = structuredClone(workflowTemplateFixtures);
  activityCountBefore = activityEventFixtures.length;
  await signInAs(GUS_ADMIN_IDENTITY_ID);
});

afterEach(() => {
  caseFixtures.splice(0, caseFixtures.length, ...casesBefore);
  workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...templatesBefore);
  activityEventFixtures.splice(activityCountBefore);
});

describe('POST /api/cases/[caseId]/workflow', () => {
  it('a dry run (no confirm) returns the preview and writes nothing', async () => {
    const viewing = approveViewing();
    const target = gusCase(4);
    const response = await post(target.id, {
      organizationId: GUS,
      serviceTypeCode: 'CREMATION_WITH_VIEWING',
      expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied).toBe(false);
    expect(body.preview).toMatchObject({
      unchanged: false,
      from: { workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, serviceTypeCode: 'DIRECT_CREMATION' },
      to: { workflowTemplateId: viewing.id, serviceTypeCode: 'CREMATION_WITH_VIEWING' },
    });
    expect(Array.isArray(body.preview.kept)).toBe(true);
    expect(caseFixtures.find((c) => c.id === target.id)).toEqual(casesBefore.find((c) => c.id === target.id));
    expect(activityEventFixtures.length).toBe(activityCountBefore);
  });

  it('confirm: true writes the new snapshot, appends history and records activity', async () => {
    const viewing = approveViewing();
    const target = gusCase(4);
    const response = await post(target.id, {
      organizationId: GUS,
      serviceTypeCode: 'CREMATION_WITH_VIEWING',
      expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID,
      confirm: true,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied).toBe(true);
    const stored = caseFixtures.find((c) => c.id === target.id)!;
    expect(stored.workflowTemplateId).toBe(viewing.id);
    expect(stored.workflowSnapshot?.serviceTypeCode).toBe('CREMATION_WITH_VIEWING');
    expect(stored.workflowHistory).toHaveLength(1);
    expect(stored.workflowHistory![0]).toMatchObject({
      workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID,
      serviceTypeCode: 'DIRECT_CREMATION',
      rawStage: target.rawStage,
      checklistState: target.checklistState,
      changedByUserId: GUS_ADMIN_IDENTITY_ID,
    });
    const event = activityEventFixtures[activityEventFixtures.length - 1];
    expect(event).toMatchObject({ eventType: 'case.workflow.changed', caseId: target.id, organizationId: GUS });
  });

  it('refuses a draft target with 422 and the staff-facing approval message', async () => {
    const response = await post(gusCase(2).id, {
      organizationId: GUS,
      serviceTypeCode: 'DIRECT_ENTOMBMENT',
      expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID,
      confirm: true,
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/has not been approved yet/);
    expect(caseFixtures).toEqual(casesBefore);
  });

  it('refuses a stale expected workflow with 409', async () => {
    approveViewing();
    const response = await post(gusCase(2).id, {
      organizationId: GUS,
      serviceTypeCode: 'CREMATION_WITH_VIEWING',
      expectedWorkflowTemplateId: 'not-the-current-template',
      confirm: true,
    });
    expect(response.status).toBe(409);
    expect(caseFixtures).toEqual(casesBefore);
  });

  it('another organization’s case is not found (404); another organization id is refused (403)', async () => {
    const manorsCase = caseFixtures.find((c) => c.organizationId === MANORS)!;
    const notFound = await post(manorsCase.id, {
      organizationId: GUS,
      serviceTypeCode: 'DIRECT_CREMATION',
      expectedWorkflowTemplateId: manorsCase.workflowTemplateId,
    });
    expect(notFound.status).toBe(404);
    const crossOrg = await post(manorsCase.id, {
      organizationId: MANORS,
      serviceTypeCode: 'DIRECT_CREMATION',
      expectedWorkflowTemplateId: manorsCase.workflowTemplateId,
    });
    expect(crossOrg.status).toBe(403);
    expect(caseFixtures).toEqual(casesBefore);
  });

  it('Manors never changes workflow (403), even for its own administrator', async () => {
    await signInAs(MANORS_ADMIN_IDENTITY_ID);
    const manorsCase = caseFixtures.find((c) => c.organizationId === MANORS)!;
    const response = await post(manorsCase.id, {
      organizationId: MANORS,
      serviceTypeCode: 'DIRECT_CREMATION',
      expectedWorkflowTemplateId: manorsCase.workflowTemplateId,
      confirm: true,
    });
    expect(response.status).toBe(403);
    expect(caseFixtures).toEqual(casesBefore);
  });

  it('requires case.update — a read-only member is refused (403)', async () => {
    await signInAs(GUS_VIEWER_IDENTITY_ID);
    approveViewing();
    const response = await post(gusCase(2).id, {
      organizationId: GUS,
      serviceTypeCode: 'CREMATION_WITH_VIEWING',
      expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID,
      confirm: true,
    });
    expect(response.status).toBe(403);
    expect(caseFixtures).toEqual(casesBefore);
  });

  it('the same service is "unchanged" and writes nothing even with confirm', async () => {
    const response = await post(gusCase(2).id, {
      organizationId: GUS,
      serviceTypeCode: 'DIRECT_CREMATION',
      expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID,
      confirm: true,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: false, preview: { unchanged: true } });
    expect(caseFixtures).toEqual(casesBefore);
  });
});
