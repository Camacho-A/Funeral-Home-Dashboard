import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { paymentRecordFixtures } from '@/services/__mocks__/paymentFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { hashPassword } from '@/lib/identity/passwordHashing';

let familySession: { portalUserId: string; sessionId: string; aud: 'family'; issuedAt: number; expiresAt: number } | null = null;
vi.mock('@/lib/auth/familySession', () => ({
  getFamilySession: async () => familySession,
  clearFamilySession: async () => undefined,
}));

const { GET } = await import('./route');

const TEST_CASE_ID = 'case-family-payments-list-route-test';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-payments-list-route-test-${idCounter}`;
}

function getRequest() {
  return GET(new Request(`http://localhost/api/family/cases/${TEST_CASE_ID}/payments`), { params: Promise.resolve({ caseId: TEST_CASE_ID }) });
}

let lengths: { users: number; sessions: number; access: number; payments: number };
beforeEach(() => {
  idCounter = 0;
  familySession = null;
  lengths = { users: portalUserFixtures.length, sessions: portalSessionFixtures.length, access: portalAccessFixtures.length, payments: paymentRecordFixtures.length };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
  portalAccessFixtures.length = lengths.access;
  paymentRecordFixtures.length = lengths.payments;
});

describe('GET /api/family/cases/[caseId]/payments', () => {
  it('returns 401 with no family session', async () => {
    expect((await getRequest()).status).toBe(401);
  });

  it('returns the allowlisted payment history for an authorized portal user', async () => {
    const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
    const { createPortalSession } = await import('@/services/portal/portalSessionService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'family-payments-list@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
    familySession = { portalUserId: portalUser.id, sessionId: session.id, aud: 'family', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
    portalAccessFixtures.push({
      id: 'access-1',
      portalUserId: portalUser.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: TEST_CASE_ID,
      relationshipType: 'primary_next_of_kin',
      status: 'active',
      grantedFromInvitationId: 'invitation-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    paymentRecordFixtures.push({
      id: 'payment-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: TEST_CASE_ID,
      caseOrderId: 'case-order-1',
      provider: 'clover',
      providerCheckoutId: 'checkout-1',
      idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
      providerPaymentId: null,
      status: 'succeeded',
      amount: 25000,
      currency: 'usd',
      purpose: 'Case order balance due',
      checkoutUrl: null,
      cardBrand: 'visa',
      cardLast4: '4242',
      receiptReference: 'RCPT-1',
      failureCode: null,
      failureMessage: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      paidAt: '2026-08-01T00:05:00.000Z',
      updatedAt: '2026-08-01T00:05:00.000Z',
      initiatedByStaffProfileId: null, depositedInBankDepositId: null,
    });

    const response = await getRequest();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).not.toHaveProperty('providerCheckoutId');
  });
});
