import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures } from '@/services/__mocks__/identityFixtures';
import { GUS_ADMIN_IDENTITY_ID, GUS_DIRECTOR_IDENTITY_ID } from '@/services/__mocks__/gusFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { completionItemOptions, finalItemsCompletionPolicy } from '@/domain/workflow/completionPolicy';
import { evaluateCaseCompletion } from '@/domain/cases/completionEligibility';
import { burialStages, burialTemplate, burialVersion, caseOn, GUS } from '@/domain/workflow/crossServiceRegression.fixtures';
import type { ManualCompletionPermission } from '@/types/workflowTemplate';

/**
 * Service-specific completion (2026-10). POST /api/cases/[caseId]/complete
 * — the staff "Mark completed" action, gated by the case's frozen policy
 * and an existing permission, audited as `case.completed`. Fictional
 * cases and workflow steps only (mock adapter).
 */

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: vi.fn(async () => undefined),
  clearSession: vi.fn(),
}));

const { createIdentitySession } = await import('@/services/sessionService');
const complete = await import('./route');

let n = 0;
async function signInAs(identityId: string) {
  const identity = identityFixtures.find((i) => i.id === identityId)!;
  const session = await createIdentitySession(
    { identityId, deviceId: 'complete-route-test', passwordVersionAtIssue: identity.passwordVersion, idFactory: () => `cp-${++n}` },
    'mock',
  );
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
}

function post(caseId: string, body: Record<string, unknown>) {
  return complete.POST(
    new Request(`http://localhost/api/cases/${caseId}/complete`, {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({ organizationId: GUS, expectedRevision: (caseFixtures.find((c) => c.id === caseId)?.revision ?? 0), ...body }),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}

const committal = completionItemOptions(burialStages()).find((o) => o.ref.label === 'Fictional committal confirmed')!.ref;

/** A fictional burial case on its final stage whose policy allows manual
    completion, gated by `permission`. */
function seedCase(id: string, permission: ManualCompletionPermission = 'case.delete', archiveEligibility: 'on_completion' | 'manual' = 'on_completion') {
  const version = {
    ...burialVersion(1, burialStages()),
    completionPolicy: { ...finalItemsCompletionPolicy({ requiredFinalItems: [committal] }), manualCompletion: { allowed: true, permission }, archiveEligibility },
  };
  const c = caseOn(burialTemplate([version]), version, id, 5);
  caseFixtures.push(c);
  return c;
}

let casesBefore: typeof caseFixtures;
let eventsBefore: number;
let adapterBefore: string | undefined;

beforeEach(async () => {
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  adapterBefore = process.env.DATA_ADAPTER;
  process.env.DATA_ADAPTER = 'mock';
  casesBefore = structuredClone(caseFixtures);
  eventsBefore = activityEventFixtures.length;
  await signInAs(GUS_ADMIN_IDENTITY_ID);
});

afterEach(() => {
  caseFixtures.splice(0, caseFixtures.length, ...casesBefore);
  activityEventFixtures.splice(eventsBefore);
  if (adapterBefore === undefined) delete process.env.DATA_ADAPTER;
  else process.env.DATA_ADAPTER = adapterBefore;
});

describe('POST /api/cases/[caseId]/complete — manual completion', () => {
  it('an administrator completes the case: recorded on the case, audited as case.completed (manual, policy, actor), then archived per the policy', async () => {
    seedCase('fict-manual-1');
    const response = await post('fict-manual-1', { reason: 'Fictional: committal confirmed by the cemetery by phone' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.completion).toEqual({ mode: 'manual', archived: true });

    const stored = caseFixtures.find((c) => c.id === 'fict-manual-1')!;
    expect(stored.manualCompletion).toMatchObject({ completedBy: GUS_ADMIN_IDENTITY_ID, reason: 'Fictional: committal confirmed by the cemetery by phone' });
    expect(stored).toMatchObject({ rawStage: 5, isDeleted: true });
    expect(evaluateCaseCompletion(stored)).toMatchObject({ eligible: true, mode: 'manual' });

    const events = activityEventFixtures.slice(eventsBefore);
    expect(events.map((e) => e.eventType)).toEqual(['case.completed', 'case.archived']);
    const [completed, archived] = events;
    expect(completed).toMatchObject({ caseId: 'fict-manual-1', actorIdentityId: GUS_ADMIN_IDENTITY_ID, isSystemGenerated: false });
    expect(JSON.parse(completed.metadata!)).toMatchObject({
      mode: 'manual',
      policyKind: 'final_items',
      requiresRemainsReturn: false,
      requiredFinalItems: [committal],
      legacyPolicy: false,
      archivesOnCompletion: true,
      reason: 'Fictional: committal confirmed by the cemetery by phone',
    });
    expect(archived).toMatchObject({ actorIdentityId: null, isSystemGenerated: true });
  });

  it('a policy that keeps completed cases in the working lists completes without archiving', async () => {
    seedCase('fict-manual-2', 'case.delete', 'manual');
    const response = await post('fict-manual-2', { reason: 'Fictional reason' });
    expect((await response.json()).completion).toEqual({ mode: 'manual', archived: false });
    expect(caseFixtures.find((c) => c.id === 'fict-manual-2')!.isDeleted).toBe(false);
    expect(activityEventFixtures.slice(eventsBefore).map((e) => e.eventType)).toEqual(['case.completed']);
  });

  it('is gated by the policy’s EXISTING permission: a funeral director (no case.delete) is refused; case.update lets them', async () => {
    seedCase('fict-manual-3');
    await signInAs(GUS_DIRECTOR_IDENTITY_ID);
    const refused = await post('fict-manual-3', { reason: 'Fictional reason' });
    expect(refused.status).toBe(403);
    expect(caseFixtures.find((c) => c.id === 'fict-manual-3')!.manualCompletion).toBeUndefined();
    expect(activityEventFixtures.length).toBe(eventsBefore);

    seedCase('fict-manual-4', 'case.update');
    expect((await post('fict-manual-4', { reason: 'Fictional reason' })).status).toBe(200);
  });

  it('refuses a workflow that does not allow it (Direct Cremation), a missing reason, a second completion, and another organization’s case', async () => {
    const direct = caseFixtures.find((c) => c.organizationId === GUS && c.workflowSnapshot?.completionPolicy?.kind === 'remains_return')!;
    const before = structuredClone(direct);
    expect((await post(direct.id, { reason: 'Fictional reason' })).status).toBe(422);
    expect(caseFixtures.find((c) => c.id === direct.id)).toEqual(before);

    seedCase('fict-manual-5');
    expect((await post('fict-manual-5', {})).status).toBe(422);
    expect((await post('fict-manual-5', { reason: 'Fictional reason' })).status).toBe(200);
    // Now complete (and archived): a second attempt changes nothing.
    expect((await post('fict-manual-5', { reason: 'Again' })).status).toBe(409);

    const manors = caseFixtures.find((c) => c.organizationId === 'managed-cremations')!;
    expect((await post(manors.id, { reason: 'Fictional reason' })).status).toBe(404);
  });

  // Wix mode (case concurrency, 2026-10) is now wired through the case
  // write service; its contract — applied, revision conflict 409,
  // concurrent completion, organization isolation — is covered against
  // the in-memory Wix stand-in in route.wix.test.ts, never a live backend.
});
