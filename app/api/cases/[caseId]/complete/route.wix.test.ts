import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { completionItemOptions, finalItemsCompletionPolicy } from '@/domain/workflow/completionPolicy';
import { burialStages, burialTemplate, burialVersion, caseOn, GUS } from '@/domain/workflow/crossServiceRegression.fixtures';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import type { Case } from '@/types/case';

/**
 * Case concurrency (2026-10) — Wix-adapter contract tests for POST
 * /api/cases/[caseId]/complete (manual completion): the REAL route, case
 * write service, mapper (`manualCompletion` column) and activity
 * recording against lib/testing/inMemoryWixData.ts, fictional rows only,
 * no network. Covers the persisted completion/archive fields, the
 * revision-conditioned field-scoped write, conflicts (409), a concurrent
 * completion, organization isolation and Wix write failures.
 */

const wix = await vi.hoisted(async () => (await import('@/lib/testing/inMemoryWixData')).createInMemoryWixData());
vi.mock('@/lib/wixDataApi', () => wix.api);

const ADMIN = 'identity-gus-test-admin';
const auth = vi.hoisted(() => ({ organizationId: 'gus-camacho-jr' }));
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: async (requested: string) =>
    requested === auth.organizationId
      ? { authorized: true, context: { organizationId: auth.organizationId, userId: 'identity-gus-test-admin', role: 'administrator' } }
      : { authorized: false, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) },
}));
vi.mock('@/services/authorizationPolicyService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/authorizationPolicyService')>()),
  canEditCase: async () => true,
  canDeleteCase: async () => true,
}));
vi.mock('@/lib/auth/currentActorDisplayName', () => ({ currentActorDisplayName: async () => 'Fictional Admin' }));

const { POST } = await import('./route');

const committal = completionItemOptions(burialStages()).find((o) => o.ref.label === 'Fictional committal confirmed')!.ref;

function fictionalCase(id: string, archiveEligibility: 'on_completion' | 'manual' = 'on_completion'): Case {
  const version = {
    ...burialVersion(1, burialStages()),
    completionPolicy: { ...finalItemsCompletionPolicy({ requiredFinalItems: [committal] }), manualCompletion: { allowed: true, permission: 'case.delete' as const }, archiveEligibility },
  };
  return caseOn(burialTemplate([version]), version, id, 5);
}

function wixRow(c: Case): Record<string, unknown> {
  return {
    beaconCaseId: c.id,
    organizationId: c.organizationId,
    caseNumber: c.caseNumber,
    caseType: c.caseType,
    workflowTemplateId: c.workflowTemplateId,
    workflowTemplateVersion: c.workflowTemplateVersion,
    workflowSnapshot: c.workflowSnapshot,
    currentStage: c.rawStage,
    checklistState: c.checklistState,
    fieldValues: c.fieldValues,
    decedentName: c.decedentName,
    dateOfBirth: c.dateOfBirth ?? '',
    dateOfDeath: c.dateOfDeath ?? '',
    timeOfDeath: c.timeOfDeath ?? '',
    placeOfDeath: c.placeOfDeath ?? '',
    weight: String(c.weight ?? ''),
    nextOfKinName: c.nextOfKinName ?? '',
    nextOfKinPhone: c.nextOfKinPhone ?? '',
    paymentStatus: 'awaiting_payment',
    returnMethod: c.returnMethod,
    pickupStatus: c.pickupStatus,
    daysWaitingInStage: c.daysWaitingInStage,
    isVeteran: false,
    isArchived: false,
    createdAt: c.createdAt,
  };
}

function post(caseId: string, body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/cases/${caseId}/complete`, {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({ organizationId: GUS, expectedRevision: ((wix.get('cases', caseId) as { revision?: unknown } | undefined)?.revision as number | undefined ?? 0), ...body }),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}
const row = (id: string) => wix.get('cases', id) as WixCaseItem;

let originalAdapter: string | undefined;
beforeEach(() => {
  originalAdapter = process.env.DATA_ADAPTER;
  process.env.DATA_ADAPTER = 'wix';
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  auth.organizationId = GUS;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  wix.reset();
  wix.seed('cases', 'fict-wix-complete-1', wixRow(fictionalCase('fict-wix-complete-1')));
  wix.seed('cases', 'fict-wix-complete-keep', wixRow(fictionalCase('fict-wix-complete-keep', 'manual')));
});

afterEach(() => {
  if (originalAdapter === undefined) delete process.env.DATA_ADAPTER;
  else process.env.DATA_ADAPTER = originalAdapter;
  vi.restoreAllMocks();
});

describe('manual completion (Wix) — persistence', () => {
  it('applies ONE field-scoped conditional patch: final stage, manualCompletion, archive fields and the revision', async () => {
    const before = row('fict-wix-complete-1');
    const response = await post('fict-wix-complete-1', { reason: 'Fictional: confirmed by phone' });
    expect(response.status).toBe(200);
    expect((await response.json()).completion).toEqual({ mode: 'manual', archived: true });

    const writes = wix.writes().filter((op) => op.collection === 'cases');
    expect(writes).toHaveLength(1);
    expect([...writes[0].fields!].sort()).toEqual(['archivedAt', 'isArchived', 'manualCompletion', 'revision']);
    expect(wix.conditions.filter((c) => c.collection === 'cases')[0].filter).toEqual({
      organizationId: { $eq: GUS },
      beaconCaseId: { $eq: 'fict-wix-complete-1' },
      revision: { $eq: null },
    });
    const after = row('fict-wix-complete-1');
    expect(after).toMatchObject({ isArchived: true, revision: 1, currentStage: 5 });
    expect(after.manualCompletion).toMatchObject({ completedBy: ADMIN, completedByName: 'Fictional Admin', reason: 'Fictional: confirmed by phone' });
    // Every field the completion doesn't own is untouched.
    expect({ ...after, isArchived: undefined, archivedAt: undefined, manualCompletion: undefined, revision: undefined }).toEqual({
      ...before,
      isArchived: undefined,
    });
    // Read back through the mapper.
    expect(mapWixCaseItem(after)?.manualCompletion?.reason).toBe('Fictional: confirmed by phone');

    const events = wix.rows('activityEvents', { caseId: 'fict-wix-complete-1' }).map((r) => r.data.eventType);
    expect(events).toEqual(['case.completed', 'case.archived']);
  });

  it('a policy that does not archive on completion writes no archive fields', async () => {
    expect((await post('fict-wix-complete-keep', { reason: 'Fictional reason' })).status).toBe(200);
    const [write] = wix.writes().filter((op) => op.collection === 'cases');
    expect([...write.fields!].sort()).toEqual(['manualCompletion', 'revision']);
    expect(row('fict-wix-complete-keep').isArchived).toBe(false);
  });
});

describe('manual completion (Wix) — concurrency', () => {
  it('a stale expectedRevision → 409 with the current case, nothing written', async () => {
    wix.seed('cases', 'fict-wix-complete-1', { ...row('fict-wix-complete-1'), revision: 3 });
    const response = await post('fict-wix-complete-1', { reason: 'Fictional reason', expectedRevision: 2 });
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe('revision_conflict');
    expect(wix.writes().filter((op) => op.collection === 'cases')).toEqual([]);
  });

  it('a write landing between the decision and the patch is preserved, and the completion is refused (409) — staff completed a version that no longer exists (Phase 5A.1)', async () => {
    let fired = false;
    wix.onBeforeOp((op) => {
      if (!fired && op.op === 'patch' && op.collection === 'cases') {
        fired = true;
        wix.seed('cases', 'fict-wix-complete-1', { ...row('fict-wix-complete-1'), weight: '201 lb', revision: 1 });
      }
    });
    const response = await post('fict-wix-complete-1', { reason: 'Fictional reason' });
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe('revision_conflict');
    expect(row('fict-wix-complete-1')).toMatchObject({ weight: '201 lb', revision: 1 });
    expect(row('fict-wix-complete-1').manualCompletion).toBeUndefined();
    expect(row('fict-wix-complete-1').isArchived).not.toBe(true);
  });

  it('a completion without expectedRevision is refused 428 — nothing written (Phase 5A.1)', async () => {
    const before = wix.snapshot();
    const response = await post('fict-wix-complete-1', { reason: 'Fictional reason', expectedRevision: undefined });
    expect(response.status).toBe(428);
    expect((await response.json()).reason).toBe('revision_required');
    expect(wix.snapshot()).toEqual(before);
  });

  it('two administrators completing at once: exactly one completion is written, the other is told it is already complete', async () => {
    const [a, b] = await Promise.all([post('fict-wix-complete-keep', { reason: 'First' }), post('fict-wix-complete-keep', { reason: 'Second' })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(wix.writes().filter((op) => op.collection === 'cases' && op.fields?.includes('manualCompletion'))).toHaveLength(2);
    expect(row('fict-wix-complete-keep').revision).toBe(1);
    expect(['First', 'Second']).toContain((row('fict-wix-complete-keep').manualCompletion as { reason: string }).reason);
  });
});

describe('manual completion (Wix) — isolation and failures', () => {
  it("another organization's case is 404 and nothing is written", async () => {
    const manors = caseFixtures.find((c) => c.organizationId === 'managed-cremations')!;
    wix.seed('cases', manors.id, wixRow(manors));
    const before = wix.snapshot();
    expect((await post(manors.id, { reason: 'Fictional reason' })).status).toBe(404);
    expect(wix.snapshot()).toEqual(before);
  });

  it('a Wix 5xx on the write → 503, nothing written, no completion event', async () => {
    wix.failNext('patch', 'cases', 503);
    expect((await post('fict-wix-complete-1', { reason: 'Fictional reason' })).status).toBe(503);
    expect(row('fict-wix-complete-1').manualCompletion).toBeUndefined();
    expect(wix.rows('activityEvents', { eventType: 'case.completed' })).toEqual([]);
  });
});
