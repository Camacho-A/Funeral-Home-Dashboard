import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockReadOnlyUser } from '@/services/__mocks__/authFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { caseFormLinkFixtures, ARRANGEMENT_FORMS_FORM_CONFIG_ID } from '@/services/__mocks__/externalFormFixtures';
import { standardCremationWorkflowTemplateFixture } from '@/services/__mocks__/workflowTemplates';
import { buildCaseWorkflowSnapshot } from '@/domain/workflow/snapshot';
import type { Case } from '@/types/case';
import type { CaseFormLink } from '@/types/caseFormLink';

/**
 * Manors workflow reconciliation (2026-09) — the Administrator-safe
 * "Recalculate Workflow" repair action (checkpoint's Part A5). Mock-mode
 * only: this route's own logic is a thin authorization wrapper around
 * `reconcileCaseWorkflow`, already exhaustively tested directly in
 * services/workflowReconciliationService.test.ts — these tests cover the
 * route-level authorization/wiring, not the reconciliation algorithm
 * itself again.
 */

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

const SAME_ORIGIN_HEADERS = { origin: 'http://localhost', host: 'localhost', 'Content-Type': 'application/json' };

function postRequest(caseId: string, body: unknown, headers: Record<string, string> = SAME_ORIGIN_HEADERS) {
  return POST(new Request(`http://localhost/api/cases/${caseId}/recalculate-workflow`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId }),
  });
}

// Structured Certifier data (2026-09, ADR-041): explicitly pinned to
// versions[0] (v1), never `latestTemplateVersion` — see
// services/workflowReconciliationService.test.ts's identical fix for why
// (this route delegates straight to that service's reconciliation logic
// against the same dcContact-era 11-item First Call & Payment shape).
const SNAPSHOT_VERSION = standardCremationWorkflowTemplateFixture.versions[0];

function seedTestCase(): Case {
  const case_: Case = {
    id: `recalc-test-${Math.random().toString(36).slice(2)}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-901',
    decedentName: 'Test Decedent',
    dateOfBirth: '01/01/1950',
    dateOfDeath: '01/01/2026',
    timeOfDeath: '10:00',
    placeOfDeath: 'Test Hospital',
    weight: '150 lb',
    rawStage: 0,
    assignedStaffId: null,
    nextOfKinName: 'Test NOK',
    nextOfKinPhone: '555-0100',
    nextOfKinEmail: null,
    nextOfKinRelationship: null,
    nextOfKinRelationshipOther: null,
    certifierName: null,
    certifierPhone: null,
    certifierLicenseNumber: null,
    certifierFax: null,
    tagNumber: null,
    paymentStatus: 'paid_in_full',
    pickupStatus: 'awaiting_pickup',
    pickupReleasedTo: null,
    pickupReleasedAt: null,
    pickupNote: null,
    returnMethod: 'undecided',
    shippingCarrier: null,
    shippingTrackingNumber: null,
    shippingDateShipped: null,
    shippingDeliveryStatus: null,
    shippingDeliveredAt: null,
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    vaNotificationResponsibility: null,
    // displayStage 0 — composite-keyed per B2026-035's fix
    // (domain/workflow/checklistItemKey.ts). Checklist default-done fix
    // (2026-10): displayStage 0's rawStage-1 StageTemplate twin treats
    // these same local indices 0-7 as manual, so they need an explicit
    // composite key too — not just the historical 8/9/10.
    checklistState: {
      '0:0': true,
      '0:1': true,
      '0:2': true,
      '0:3': true,
      '0:4': true,
      '0:5': true,
      '0:6': true,
      '0:7': true,
      '0:8': true,
      '0:9': true,
      '0:10': true,
    },
    fieldValues: { 0: 'X', 1: 'X', 2: 'X', 3: 'X', 4: 'X', 5: 'X', 6: 'X', 7: 'X', 9: 'X', 10: 'X' },
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    createdBy: null,
    intakeOwnerId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    isDeleted: false,
    workflowTemplateId: standardCremationWorkflowTemplateFixture.id,
    workflowTemplateVersion: SNAPSHOT_VERSION.version,
    caseType: 'cremation',
    workflowSnapshot: buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, SNAPSHOT_VERSION),
  };
  caseFixtures.push(case_);
  return case_;
}

function linkArrangementForm(caseId: string): void {
  const link: CaseFormLink = {
    id: `link-recalc-${caseId}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId,
    provider: 'jotform',
    formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID,
    linkTokenHash: 'hash',
    status: 'received',
    sentAt: '2026-01-01T00:00:00.000Z',
    submissionId: `sub-recalc-${caseId}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  caseFormLinkFixtures.push(link);
}

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
});

afterEach(() => {
  caseFixtures.length = 0;
  caseFormLinkFixtures.length = 0;
  vi.restoreAllMocks();
});

describe('POST /api/cases/[caseId]/recalculate-workflow', () => {
  it('9: reconciles an already-imported case (no re-import, no new case) — Administrator can repair it after deployment', async () => {
    const case_ = seedTestCase();
    linkArrangementForm(case_.id);
    const caseCountBefore = caseFixtures.length;

    const response = await postRequest(case_.id, { organizationId: DEFAULT_ORGANIZATION_ID });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ rawStage: 3, changed: true });
    expect(caseFixtures).toHaveLength(caseCountBefore); // no case created/duplicated
  });

  it('is idempotent — a second call after the first reports unchanged', async () => {
    const case_ = seedTestCase();
    linkArrangementForm(case_.id);

    await postRequest(case_.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    const second = await postRequest(case_.id, { organizationId: DEFAULT_ORGANIZATION_ID });

    expect((await second.json())).toEqual({ rawStage: 3, changed: false });
  });

  it('rejects a cross-site request (CSRF)', async () => {
    const case_ = seedTestCase();
    const response = await postRequest(case_.id, { organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'https://evil.example.com', host: 'localhost', 'Content-Type': 'application/json' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    const case_ = seedTestCase();
    const response = await postRequest(case_.id, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(401);
  });

  it('returns 400 when organizationId is missing', async () => {
    const case_ = seedTestCase();
    const response = await postRequest(case_.id, {});
    expect(response.status).toBe(400);
  });

  it('returns 403 for a caller without case.update (Read Only)', async () => {
    mockSession = { user: mockReadOnlyUser };
    const response = await postRequest('some-case', { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a forged organizationId the caller has no membership in', async () => {
    const response = await postRequest('some-case', { organizationId: SECOND_MOCK_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });
});
