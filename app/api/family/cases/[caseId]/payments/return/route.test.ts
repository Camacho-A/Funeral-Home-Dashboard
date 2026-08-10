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

const TEST_CASE_ID = 'case-family-payments-return-route-test';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-payments-return-route-test-${idCounter}`;
}

function returnRequest(paymentId: string | null) {
  const params = new URLSearchParams({ ...(paymentId ? { paymentId } : {}) });
  return GET(new Request(`http://localhost/api/family/cases/${TEST_CASE_ID}/payments/return?${params.toString()}`), { params: Promise.resolve({ caseId: TEST_CASE_ID }) });
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

async function seedAuthorizedSession() {
  const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
  const { createPortalSession } = await import('@/services/portal/portalSessionService');
  const { portalUser } = await findOrCreatePortalUser(
    { email: 'family-return@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
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
}

describe('GET /api/family/cases/[caseId]/payments/return', () => {
  it('returns 401 with no family session', async () => {
    expect((await returnRequest('payment-1')).status).toBe(401);
  });

  it('rejects a missing paymentId', async () => {
    await seedAuthorizedSession();
    expect((await returnRequest(null)).status).toBe(400);
  });

  it('returns 404 for a payment belonging to a different case', async () => {
    await seedAuthorizedSession();
    paymentRecordFixtures.push({
      id: 'payment-other-case',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: 'a-different-case',
      caseOrderId: null,
      provider: 'clover',
      providerCheckoutId: 'checkout-1',
      idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
      providerPaymentId: null,
      status: 'pending',
      amount: 1000,
      currency: 'usd',
      purpose: 'x',
      checkoutUrl: null,
      cardBrand: null,
      cardLast4: null,
      receiptReference: null,
      failureCode: null,
      failureMessage: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      paidAt: null,
      updatedAt: '2026-08-01T00:00:00.000Z',
      initiatedByStaffProfileId: null, depositedInBankDepositId: null,
    });

    expect((await returnRequest('payment-other-case')).status).toBe(404);
  });

  it('returns the payment status DTO for a payment belonging to this case', async () => {
    await seedAuthorizedSession();
    paymentRecordFixtures.push({
      id: 'payment-mine',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: TEST_CASE_ID,
      caseOrderId: null,
      provider: 'clover',
      providerCheckoutId: 'checkout-1',
      idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
      providerPaymentId: null,
      status: 'succeeded',
      amount: 5000,
      currency: 'usd',
      purpose: 'x',
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

    const response = await returnRequest('payment-mine');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.payment.status).toBe('succeeded');
    expect(body.payment).not.toHaveProperty('providerCheckoutId');
    expect(body.payment).not.toHaveProperty('idempotencyKey');
    expect(body.payment).not.toHaveProperty('providerPaymentId');
    expect(body.payment).not.toHaveProperty('failureCode');
    expect(body.payment).not.toHaveProperty('failureMessage');
    expect(body.payment).not.toHaveProperty('checkoutUrl');
  });
});
