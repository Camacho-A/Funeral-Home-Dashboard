import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { paymentRecordFixtures, paymentIntegrationFixtures } from '@/services/__mocks__/paymentFixtures';
import { caseOrderFixtures } from '@/services/__mocks__/pricingFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { hashPassword } from '@/lib/identity/passwordHashing';
import { resetRateLimiter } from '@/lib/rateLimiter';
import type { CaseOrder } from '@/types/caseOrder';

let familySession: { portalUserId: string; sessionId: string; aud: 'family'; issuedAt: number; expiresAt: number } | null = null;
vi.mock('@/lib/auth/familySession', () => ({
  getFamilySession: async () => familySession,
  clearFamilySession: async () => undefined,
}));

const { POST } = await import('./route');

const TEST_CASE_ID = 'case-family-payments-checkout-route-test';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-payments-checkout-route-test-${idCounter}`;
}

function checkoutRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/family/cases/${TEST_CASE_ID}/payments/checkout`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId: TEST_CASE_ID }),
  });
}

function makeOrder(overrides: Partial<CaseOrder> = {}): CaseOrder {
  return {
    id: 'case-order-checkout-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: TEST_CASE_ID,
    status: 'active',
    subtotal: 40000,
    discountTotal: 0,
    taxTotal: 0,
    total: 40000,
    balanceDue: 40000,
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

let lengths: { users: number; sessions: number; access: number; payments: number; orders: number };
beforeEach(() => {
  idCounter = 0;
  familySession = null;
  resetRateLimiter();
  lengths = {
    users: portalUserFixtures.length,
    sessions: portalSessionFixtures.length,
    access: portalAccessFixtures.length,
    payments: paymentRecordFixtures.length,
    orders: caseOrderFixtures.length,
  };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
  portalAccessFixtures.length = lengths.access;
  paymentRecordFixtures.length = lengths.payments;
  caseOrderFixtures.length = lengths.orders;
});

async function seedAuthorizedSession() {
  const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
  const { createPortalSession } = await import('@/services/portal/portalSessionService');
  const { portalUser } = await findOrCreatePortalUser(
    { email: 'family-checkout@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
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

describe('POST /api/family/cases/[caseId]/payments/checkout', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    expect((await checkoutRequest({ idempotencyKey: 'k1' }, { origin: 'http://evil.test', host: 'localhost' })).status).toBe(403);
  });

  it('returns 401 with no family session', async () => {
    expect((await checkoutRequest({ idempotencyKey: 'k1' })).status).toBe(401);
  });

  it('rejects a request that supplies an amount', async () => {
    await seedAuthorizedSession();
    const response = await checkoutRequest({ idempotencyKey: 'k1', amount: 100 });
    expect(response.status).toBe(400);
  });

  it('rejects a missing idempotencyKey', async () => {
    await seedAuthorizedSession();
    expect((await checkoutRequest({})).status).toBe(400);
  });

  it('a portal user without payment.pay (secondary_family_member) is refused', async () => {
    const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
    const { createPortalSession } = await import('@/services/portal/portalSessionService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'family-checkout-secondary@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
    familySession = { portalUserId: portalUser.id, sessionId: session.id, aud: 'family', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
    portalAccessFixtures.push({
      id: 'access-1',
      portalUserId: portalUser.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: TEST_CASE_ID,
      relationshipType: 'secondary_family_member',
      status: 'active',
      grantedFromInvitationId: 'invitation-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    expect((await checkoutRequest({ idempotencyKey: 'k1' })).status).toBe(403);
  });

  it('initiates a checkout in mock mode using the server-resolved CaseOrder.balanceDue', async () => {
    await seedAuthorizedSession();
    caseOrderFixtures.push(makeOrder());
    paymentIntegrationFixtures.push({
      id: 'integration-checkout-test',
      organizationId: DEFAULT_ORGANIZATION_ID,
      provider: 'clover',
      environment: 'sandbox',
      isEnabled: true,
      merchantIdReference: 'CLOVER_MERCHANT_ID',
      credentialReference: 'CLOVER_API_KEY',
      webhookSecretReference: 'CLOVER_WEBHOOK_SECRET',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    const response = await checkoutRequest({ idempotencyKey: 'family-checkout-key-1' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.checkoutUrl).toContain('mock=1');

    const record = paymentRecordFixtures.find((p) => p.id === body.paymentId);
    expect(record?.amount).toBe(40000);
    paymentIntegrationFixtures.pop();
  });

  it('rate-limits repeated checkout attempts per (portalUserId, caseId)', async () => {
    await seedAuthorizedSession();
    for (let i = 0; i < 10; i += 1) {
      await checkoutRequest({ idempotencyKey: `rate-limit-key-${i}` });
    }
    const response = await checkoutRequest({ idempotencyKey: 'rate-limit-key-final' });
    expect(response.status).toBe(429);
  });
});
