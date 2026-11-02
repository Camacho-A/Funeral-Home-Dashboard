import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, MANORS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/identityFixtures';
import { GUS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/gusFixtures';
import {
  workflowTemplateFixtures,
  GUS_WORKFLOW_TEMPLATE_ID,
  STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID,
} from '@/services/__mocks__/workflowTemplates';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { selectWorkflowTemplate } from '@/domain/workflow/selectWorkflowTemplate';
import { buildCaseWorkflowSnapshot } from '@/domain/workflow/snapshot';
import { addChecklistItem, removeChecklistItem, updateChecklistItem, updateStage } from '@/domain/workflow/templateEditing';
import { completionItemOptions, finalItemsCompletionPolicy } from '@/domain/workflow/completionPolicy';
import type { StageTemplate, WorkflowTemplate } from '@/types/workflowTemplate';

/** Unfinished-workflow protection (2026-10): every approval now carries the
    approver's review attestation (see approve/route.ts). */
const REVIEW_ATTESTATION = { stagesReviewed: true, checklistReviewed: true, completionReviewed: true };

/**
 * Workflow template editor (2026-10). Saving drafts and approving versions
 * end to end through the real Route Handlers in mock mode: server-side
 * validation (draft vs approval level), service assignment, authorship,
 * audit events, Time of Death preservation, existing-case protection, and
 * Manors unchanged. Fictional mock data only.
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
const versions = await import('./route');
const approve = await import('./[version]/approve/route');

let n = 0;
async function signInAs(identityId: string) {
  const identity = identityFixtures.find((i) => i.id === identityId)!;
  const session = await createIdentitySession(
    { identityId, deviceId: 'editor-route-test', passwordVersionAtIssue: identity.passwordVersion, idFactory: () => `ed-${++n}` },
    'mock',
  );
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
  return identity;
}

function save(templateId: string, organizationId: string, body: Record<string, unknown>) {
  return versions.POST(
    new Request(`http://localhost/api/workflow-templates/${templateId}/versions`, {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({ organizationId, ...body }),
    }),
    { params: Promise.resolve({ templateId }) },
  );
}

function postApprove(templateId: string, version: number, organizationId: string) {
  return approve.POST(
    new Request(`http://localhost/api/workflow-templates/${templateId}/versions/${version}/approve`, {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({ organizationId, attestation: REVIEW_ATTESTATION }),
    }),
    { params: Promise.resolve({ templateId, version: String(version) }) },
  );
}

const gusTemplate = (code: string): WorkflowTemplate =>
  workflowTemplateFixtures.find((t) => t.organizationId === GUS && t.serviceTypeCodes?.includes(code))!;
const latest = (t: WorkflowTemplate) => t.versions[t.versions.length - 1];
const gusTemplates = () => workflowTemplateFixtures.filter((t) => t.organizationId === GUS);

/** The graveside draft with its placeholder stage defined (fictional steps). */
function definedGraveside(): StageTemplate[] {
  const draft = latest(gusTemplate('GRAVESIDE_BURIAL_SERVICE_ONLY'));
  const placeholder = draft.stages.findIndex((s) => s.label.endsWith('steps to be defined'));
  const displayPosition = draft.stages[placeholder].displayStage;
  let stages = updateStage(draft.stages, displayPosition, { label: 'Graveside Service' });
  stages = addChecklistItem(stages, displayPosition, 'Example step A');
  stages = addChecklistItem(stages, displayPosition, 'Example step B');
  return stages;
}

/** A completion policy for those stages: no remains return, completed by
    the (fictional) last step of the defined stage. */
function definedGravesidePolicy(stages: StageTemplate[]) {
  const finalStep = completionItemOptions(stages).find((option) => option.ref.label === 'Example step B')!;
  return finalItemsCompletionPolicy({ requiredFinalItems: [finalStep.ref] });
}

/** A cremation-variant draft made its own (a fictional extra step), so it
    is no longer an unmodified copy of Direct Cremation. */
function ownedCremationVariant(template: WorkflowTemplate): StageTemplate[] {
  return addChecklistItem(latest(template).stages, 5, 'Example service-specific step');
}

let templatesBefore: WorkflowTemplate[];
let casesBefore: typeof caseFixtures;
let activityCountBefore: number;

beforeEach(async () => {
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  templatesBefore = structuredClone(workflowTemplateFixtures);
  casesBefore = structuredClone(caseFixtures);
  activityCountBefore = activityEventFixtures.length;
  await signInAs(GUS_ADMIN_IDENTITY_ID);
});

afterEach(() => {
  workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...templatesBefore);
  caseFixtures.splice(0, caseFixtures.length, ...casesBefore);
  activityEventFixtures.splice(activityCountBefore);
});

describe('save draft (POST .../versions)', () => {
  it('stores a Gus draft with its author and proposed service, records workflow.template.updated, and keeps Time of death’s 12-hour picker', async () => {
    const admin = identityFixtures.find((i) => i.id === GUS_ADMIN_IDENTITY_ID)!;
    const direct = workflowTemplateFixtures.find((t) => t.id === GUS_WORKFLOW_TEMPLATE_ID)!;
    const next = latest(direct).version + 1;
    const response = await save(GUS_WORKFLOW_TEMPLATE_ID, GUS, {
      stages: latest(direct).stages,
      intake: latest(direct).intake,
      serviceTypeCodes: ['DIRECT_CREMATION'],
    });
    expect(response.status).toBe(200);
    const saved = latest((await response.json()).workflowTemplate);
    expect(saved).toMatchObject({
      version: next,
      status: 'draft',
      createdBy: GUS_ADMIN_IDENTITY_ID,
      createdByName: admin.displayName,
      serviceTypeCodes: ['DIRECT_CREMATION'],
    });
    // Time of Death fix: valueKind survives the save on both raw stages.
    for (const raw of saved.stages.slice(0, 2) as StageTemplate[]) {
      expect(raw.checklist.items.find((i) => i.label === 'Time of death')).toMatchObject({ valueKind: 'time' });
    }
    expect(saved.stages).toEqual(latest(direct).stages);

    const event = activityEventFixtures[activityEventFixtures.length - 1];
    expect(event).toMatchObject({
      organizationId: GUS,
      caseId: null,
      category: 'workflow',
      eventType: 'workflow.template.updated',
      resourceType: 'workflowTemplate',
      resourceId: GUS_WORKFLOW_TEMPLATE_ID,
      actorIdentityId: GUS_ADMIN_IDENTITY_ID,
    });
    expect(JSON.parse(event.newValue!)).toEqual({ version: next, status: 'draft', serviceTypeCodes: ['DIRECT_CREMATION'] });
    expect(event.description).toMatch(new RegExp(`Direct Cremation" version ${next} saved as a draft`));
  });

  it('accepts a structurally valid but incomplete draft (empty new stage) — approval is where completeness is enforced', async () => {
    const graveside = gusTemplate('GRAVESIDE_BURIAL_SERVICE_ONLY');
    const response = await save(graveside.id, GUS, { stages: latest(graveside).stages, intake: latest(graveside).intake });
    expect(response.status).toBe(200);
  });

  it('refuses a structurally invalid version with 400 and the problem list, writing nothing', async () => {
    const direct = workflowTemplateFixtures.find((t) => t.id === GUS_WORKFLOW_TEMPLATE_ID)!;
    const broken = structuredClone(latest(direct).stages);
    broken[1].label = 'Something else'; // a combined stage's raw stages must agree
    broken[4].displayStage = 9;
    const response = await save(GUS_WORKFLOW_TEMPLATE_ID, GUS, { stages: broken, intake: latest(direct).intake });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect([...new Set(body.problems.map((p: { code: string }) => p.code))].sort()).toEqual(['combined_stage_label', 'display_stage_sequence']);
    expect(body.details).toHaveLength(body.problems.length);
    expect(workflowTemplateFixtures).toEqual(templatesBefore);
    expect(activityEventFixtures.length).toBe(activityCountBefore);
  });

  it('refuses a service that is not an active service type, and any service assignment for Manors', async () => {
    const direct = workflowTemplateFixtures.find((t) => t.id === GUS_WORKFLOW_TEMPLATE_ID)!;
    const unknown = await save(GUS_WORKFLOW_TEMPLATE_ID, GUS, { stages: latest(direct).stages, intake: latest(direct).intake, serviceTypeCodes: ['NOT_A_SERVICE'] });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).details.join(' ')).toMatch(/not one of this organization's active service types/);

    await signInAs(MANORS_ADMIN_IDENTITY_ID);
    const manors = workflowTemplateFixtures.find((t) => t.id === STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID)!;
    const response = await save(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, MANORS, {
      stages: latest(manors).stages,
      intake: latest(manors).intake,
      serviceTypeCodes: ['DIRECT_CREMATION'],
    });
    expect(response.status).toBe(400);
    expect(workflowTemplateFixtures).toEqual(templatesBefore);
  });

  it('Manors: a save is live immediately (no status, no service), Time of death keeps its picker, and is audited', async () => {
    await signInAs(MANORS_ADMIN_IDENTITY_ID);
    const manors = workflowTemplateFixtures.find((t) => t.id === STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID)!;
    const response = await save(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, MANORS, { stages: latest(manors).stages, intake: latest(manors).intake });
    expect(response.status).toBe(200);
    const saved = latest((await response.json()).workflowTemplate);
    expect('status' in saved).toBe(false);
    expect('serviceTypeCodes' in saved).toBe(false);
    expect(saved.stages[0].checklist.items[5]).toMatchObject({ label: 'Time of death', valueKind: 'time' });
    expect(selectWorkflowTemplate(workflowTemplateFixtures.filter((t) => t.organizationId === MANORS), MANORS, null)).toMatchObject({
      ok: true,
      version: { version: saved.version },
    });
    expect(activityEventFixtures[activityEventFixtures.length - 1]).toMatchObject({ eventType: 'workflow.template.updated', organizationId: MANORS });
  });
});

describe('completion policy on save (2026-10)', () => {
  it('stores a Gus draft’s completion policy with the version; omitted, the previous policy and copy source carry over', async () => {
    const graveside = gusTemplate('GRAVESIDE_BURIAL_SERVICE_ONLY');
    const stages = definedGraveside();
    const completionPolicy = definedGravesidePolicy(stages);
    const saved = await save(graveside.id, GUS, { stages, intake: latest(graveside).intake, completionPolicy });
    expect(saved.status).toBe(200);
    const stored = latest((await saved.json()).workflowTemplate);
    expect(stored).toMatchObject({ version: 2, completionPolicy });
    expect(stored.derivedFrom).toEqual(latest(graveside).derivedFrom);

    const again = await save(graveside.id, GUS, { stages, intake: latest(graveside).intake });
    expect(latest((await again.json()).workflowTemplate)).toMatchObject({ version: 3, completionPolicy });
  });

  it('refuses a malformed or incoherent policy (400), and any policy from an organization without approval (Manors unchanged)', async () => {
    const graveside = gusTemplate('GRAVESIDE_BURIAL_SERVICE_ONLY');
    const body = { stages: latest(graveside).stages, intake: latest(graveside).intake };
    expect((await save(graveside.id, GUS, { ...body, completionPolicy: { kind: 'whenever' } })).status).toBe(400);
    const mismatch = await save(graveside.id, GUS, { ...body, completionPolicy: { ...finalItemsCompletionPolicy(), requiresRemainsReturn: true } });
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).problems.map((p: { code: string }) => p.code)).toEqual(['completion_kind_mismatch']);

    await signInAs(MANORS_ADMIN_IDENTITY_ID);
    const manors = workflowTemplateFixtures.find((t) => t.id === STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID)!;
    const refused = await save(manors.id, MANORS, { stages: latest(manors).stages, intake: latest(manors).intake, completionPolicy: finalItemsCompletionPolicy() });
    expect(refused.status).toBe(400);
    // Without one, a Manors version keeps exactly its previous shape.
    const ok = await save(manors.id, MANORS, { stages: latest(manors).stages, intake: latest(manors).intake });
    const version = latest((await ok.json()).workflowTemplate);
    expect('completionPolicy' in version || 'derivedFrom' in version || 'status' in version).toBe(false);
  });
});

describe('approve (POST .../versions/[version]/approve)', () => {
  it('refuses an incomplete version with 422 and the full problem list; nothing changes', async () => {
    const graveside = gusTemplate('GRAVESIDE_BURIAL_SERVICE_ONLY');
    const response = await postApprove(graveside.id, 1, GUS);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toMatch(/cannot be approved/);
    // 2026-10: the placeholder is refused by name too, and its completion
    // requirements are still undefined.
    expect(body.problems.map((p: { code: string }) => p.code)).toEqual(['stage_without_items', 'placeholder_stage', 'completion_items_undefined']);
    expect(body.details[0]).toMatch(/Graveside burial — steps to be defined" has no checklist items/);
    expect(workflowTemplateFixtures).toEqual(templatesBefore);
    // Nothing changed — the only new event is the audited refusal.
    expect(activityEventFixtures.slice(activityCountBefore).map((e) => e.eventType)).toEqual(['workflow.template.approval_refused']);
  });

  it('approves a completed draft: it goes live, records workflow.template.published with the approver', async () => {
    const graveside = gusTemplate('GRAVESIDE_BURIAL_SERVICE_ONLY');
    const stages = definedGraveside();
    expect((await save(graveside.id, GUS, { stages, intake: latest(graveside).intake, completionPolicy: definedGravesidePolicy(stages) })).status).toBe(200);
    expect(selectWorkflowTemplate(gusTemplates(), GUS, 'GRAVESIDE_BURIAL_SERVICE_ONLY')).toMatchObject({ ok: false, reason: 'not_approved' });

    const response = await postApprove(graveside.id, 2, GUS);
    expect(response.status).toBe(200);
    const approved = (await response.json()).workflowTemplate.versions[1];
    expect(approved).toMatchObject({ status: 'approved', approvedBy: GUS_ADMIN_IDENTITY_ID, approvedByName: 'Avery Demo', createdBy: GUS_ADMIN_IDENTITY_ID });
    expect(selectWorkflowTemplate(gusTemplates(), GUS, 'GRAVESIDE_BURIAL_SERVICE_ONLY')).toMatchObject({ ok: true, version: { version: 2 } });

    const event = activityEventFixtures[activityEventFixtures.length - 1];
    expect(event).toMatchObject({ eventType: 'workflow.template.published', resourceId: graveside.id, actorIdentityId: GUS_ADMIN_IDENTITY_ID, caseId: null });
    expect(JSON.parse(event.newValue!)).toEqual({ version: 2, status: 'approved', serviceTypeCodes: ['GRAVESIDE_BURIAL_SERVICE_ONLY'] });
    expect(await postApprove(graveside.id, 2, GUS).then((r) => r.status)).toBe(409);
  });

  it('applies the version’s service assignment on approval — and refuses a service another enabled workflow serves', async () => {
    const goodbye = gusTemplate('CREMATION_WITH_FINAL_GOODBYE');
    // Point Final Goodbye at Direct Cremation's service: savable as a draft…
    await save(goodbye.id, GUS, { stages: latest(goodbye).stages, intake: latest(goodbye).intake, serviceTypeCodes: ['DIRECT_CREMATION'] });
    // …but approval refuses the second enabled workflow for one service.
    const conflict = await postApprove(goodbye.id, 2, GUS);
    expect(conflict.status).toBe(422);
    expect((await conflict.json()).problems.map((p: { code: string }) => p.code)).toEqual(['service_taken']);
    expect(gusTemplate('CREMATION_WITH_FINAL_GOODBYE').id).toBe(goodbye.id);

    // Serving both of its own codes is fine and lands on the template when approved.
    await save(goodbye.id, GUS, { stages: ownedCremationVariant(goodbye), intake: latest(goodbye).intake, serviceTypeCodes: ['CREMATION_WITH_FINAL_GOODBYE'] });
    const draft = workflowTemplateFixtures.find((t) => t.id === goodbye.id)!;
    draft.serviceTypeCodes = [];
    expect(selectWorkflowTemplate(gusTemplates(), GUS, 'CREMATION_WITH_FINAL_GOODBYE').ok).toBe(false);
    expect((await postApprove(goodbye.id, 3, GUS)).status).toBe(200);
    expect(workflowTemplateFixtures.find((t) => t.id === goodbye.id)!.serviceTypeCodes).toEqual(['CREMATION_WITH_FINAL_GOODBYE']);
    expect(selectWorkflowTemplate(gusTemplates(), GUS, 'CREMATION_WITH_FINAL_GOODBYE')).toMatchObject({ ok: true, template: { id: goodbye.id }, version: { version: 3 } });
  });

  it('two concurrent approvals of one draft: exactly one applies and is audited once; the other is 409', async () => {
    const viewing = gusTemplate('CREMATION_WITH_VIEWING');
    expect((await save(viewing.id, GUS, { stages: ownedCremationVariant(viewing), intake: latest(viewing).intake })).status).toBe(200);
    const [a, b] = await Promise.all([postApprove(viewing.id, 2, GUS), postApprove(viewing.id, 2, GUS)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(activityEventFixtures.slice(activityCountBefore).filter((e) => e.eventType === 'workflow.template.published')).toHaveLength(1);
  });

  it('cross-organization: another organization’s template is 404; Manors has no approval step (403)', async () => {
    expect((await postApprove(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, 1, GUS)).status).toBe(404);
    await signInAs(MANORS_ADMIN_IDENTITY_ID);
    expect((await postApprove(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID, 1, MANORS)).status).toBe(403);
    expect((await postApprove(GUS_WORKFLOW_TEMPLATE_ID, 1, GUS)).status).toBe(403);
    expect(workflowTemplateFixtures).toEqual(templatesBefore);
  });
});

describe('existing cases are never modified by editing or approving', () => {
  it('a Gus case keeps its frozen snapshot and checklist state through edit + approve; only NEW cases get the new version', async () => {
    const before = structuredClone(caseFixtures.filter((c) => c.organizationId === GUS));
    expect(before.length).toBeGreaterThan(0);
    const direct = workflowTemplateFixtures.find((t) => t.id === GUS_WORKFLOW_TEMPLATE_ID)!;

    // A real edit: rename a stage, drop an item, mark Weight masked.
    let stages = updateStage(latest(direct).stages, 3, { label: 'Permit & Authorization' });
    stages = removeChecklistItem(stages, 5, 3);
    stages = updateChecklistItem(stages, 0, 3, { isPasswordField: true });
    const next = latest(direct).version + 1;
    expect((await save(GUS_WORKFLOW_TEMPLATE_ID, GUS, { stages, intake: latest(direct).intake })).status).toBe(200);
    expect((await postApprove(GUS_WORKFLOW_TEMPLATE_ID, next, GUS)).status).toBe(200);

    const after = caseFixtures.filter((c) => c.organizationId === GUS);
    expect(after.map((c) => [c.id, c.workflowTemplateVersion, c.workflowSnapshot, c.checklistState, c.fieldValues, c.rawStage])).toEqual(
      before.map((c) => [c.id, c.workflowTemplateVersion, c.workflowSnapshot, c.checklistState, c.fieldValues, c.rawStage]),
    );
    expect(after.every((c) => c.workflowSnapshot?.stages.some((s) => s.label === 'Permit & Authorization Sent to Crematory'))).toBe(true);

    const selection = selectWorkflowTemplate(gusTemplates(), GUS, 'DIRECT_CREMATION');
    expect(selection).toMatchObject({ ok: true, version: { version: next } });
    if (!selection.ok) throw new Error('unreachable');
    const fresh = buildCaseWorkflowSnapshot(selection.template, selection.version, 'DIRECT_CREMATION');
    expect(fresh.stages.some((s) => s.label === 'Permit & Authorization')).toBe(true);
  });
});
