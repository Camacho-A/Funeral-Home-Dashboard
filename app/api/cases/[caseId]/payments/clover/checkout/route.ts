import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { findForbiddenPaymentFields } from '@/lib/paymentFieldGuard';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import {
  getEnabledIntegration,
  createIdempotentPendingPaymentRecord,
  updatePaymentRecord,
} from '@/services/paymentsService';
import { cloverProvider } from '@/lib/clover/cloverProvider';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Creates (or reuses) a
 * Clover Hosted Checkout session for one case. See
 * docs/adr/ADR-022-clover-hosted-checkout-integration.md for the full
 * sequence and why each step below is ordered the way it is.
 *
 * This route runs in both DATA_ADAPTER modes — unlike POST /api/cases,
 * which has no mock branch at all because mock-mode case creation stays
 * entirely client-side. A Clover checkout is a full-page browser redirect
 * to an external host; there is no equivalent client-only path in mock
 * mode, so this route always goes through the server, branching
 * internally on getDataAdapterMode() exactly like every read route does.
 * In mock mode, no real Clover API is ever called — see the mock branch
 * below.
 */

const MAX_AMOUNT_CENTS = 10_000_000; // $100,000 — a sanity ceiling, not a real business limit
const MAX_PURPOSE_LENGTH = 200;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  // Phase 19A/ADR-021 backstop: this endpoint has no business ever
  // receiving a raw card field, but the guard is cheap and uniform to
  // apply everywhere a request body is accepted.
  const forbiddenPaymentFields = findForbiddenPaymentFields(b);
  if (forbiddenPaymentFields.length > 0) {
    return NextResponse.json(
      { error: `Request must not contain payment card data (found: ${forbiddenPaymentFields.join(', ')}).` },
      { status: 400 },
    );
  }

  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  // 1. Resolve the authenticated user and authorized organization.
  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  // Amount/purpose validation (step 4) — done before any lookup so a
  // malformed request never triggers a Clover call or a stray pending
  // PaymentRecord.
  if (typeof b.amount !== 'number' || !Number.isInteger(b.amount) || b.amount <= 0 || b.amount > MAX_AMOUNT_CENTS) {
    return NextResponse.json({ error: 'amount must be a positive integer number of cents.' }, { status: 400 });
  }
  if (typeof b.purpose !== 'string' || b.purpose.trim().length === 0 || b.purpose.length > MAX_PURPOSE_LENGTH) {
    return NextResponse.json({ error: 'purpose is required and must be a non-empty string.' }, { status: 400 });
  }
  const currency = typeof b.currency === 'string' && b.currency.trim() ? b.currency.trim().toLowerCase() : 'usd';
  if (!/^[a-z]{3}$/.test(currency)) {
    return NextResponse.json({ error: 'currency must be a 3-letter ISO 4217 code.' }, { status: 400 });
  }
  if (
    typeof b.idempotencyKey !== 'string' ||
    b.idempotencyKey.trim().length === 0 ||
    b.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    return NextResponse.json({ error: 'idempotencyKey is required and must be a non-empty string.' }, { status: 400 });
  }
  const amount = b.amount;
  const purpose = b.purpose.trim();
  const idempotencyKey = b.idempotencyKey;

  const dataAdapterMode = getDataAdapterMode();

  // 2. Confirm the case belongs to this organization.
  let caseExists: boolean;
  if (dataAdapterMode === 'mock') {
    caseExists = caseFixtures.some((c) => c.id === caseId && c.organizationId === organizationId && !c.isDeleted);
  } else {
    try {
      const response = await queryWixDataItems<WixCaseItem>('cases', {
        filter: { beaconCaseId: caseId, organizationId, isArchived: false },
        paging: { limit: 1 },
      });
      caseExists = mapWixCaseItem(response.dataItems[0]?.data) !== null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
      return NextResponse.json({ error: message }, { status: 503 });
    }
  }
  if (!caseExists) {
    return NextResponse.json({ error: 'Case not found for this organization.' }, { status: 404 });
  }

  // 3. Confirm Clover is enabled for this organization.
  const integration = await getEnabledIntegration(organizationId, 'clover', dataAdapterMode);
  if (!integration) {
    return NextResponse.json({ error: 'Clover is not enabled for this organization.' }, { status: 422 });
  }

  const now = Date.now();

  // 5/8. Create a pending Beacon PaymentRecord — atomically, via Wix's own
  // unique index on the composed (organizationId, idempotencyKey) value,
  // not an application-level scan. A concurrent duplicate request (the
  // same idempotencyKey, e.g. a double-click or two racing network
  // retries of the same click) loses the insert race and is handed the
  // winner's record back instead of creating a second Clover session —
  // see services/paymentsService.ts's own comment on why this is
  // race-safe where a "check, then insert" pattern wouldn't be.
  const paymentId = crypto.randomUUID();
  const nowIso = new Date(now).toISOString();
  const { record: pendingRecord, isNew } = await createIdempotentPendingPaymentRecord(
    { id: paymentId, organizationId, caseId, provider: 'clover', amount, currency, purpose, idempotencyKey, createdAt: nowIso },
    dataAdapterMode,
  );

  if (!isNew) {
    // Someone else's request (or an earlier one of this exact same
    // idempotencyKey) already created this attempt — hand back its
    // checkoutUrl (which may be null if that attempt hasn't reached
    // Clover yet, or is already terminal) rather than starting a second
    // Clover session for the same logical attempt.
    return NextResponse.json({ paymentId: pendingRecord.id, checkoutUrl: pendingRecord.checkoutUrl });
  }

  const origin = new URL(request.url).origin;
  const returnUrl = `${origin}/cases/${caseId}/payments/return?paymentId=${paymentId}&outcome=success`;
  const cancelUrl = `${origin}/cases/${caseId}/payments/return?paymentId=${paymentId}&outcome=cancel`;

  if (dataAdapterMode === 'mock') {
    // Mock mode never calls the real Clover API — see this route's own
    // top comment. The "session" is a synthetic id and the checkout URL
    // simply points straight at Beacon's own return page, letting the
    // return page's mock-mode handling simulate an outcome locally.
    const mockCheckoutUrl = `${returnUrl}&mock=1`;
    const updated = await updatePaymentRecord(
      organizationId,
      paymentId,
      { providerCheckoutId: `mock-checkout-${paymentId}`, checkoutUrl: mockCheckoutUrl },
      dataAdapterMode,
    );
    return NextResponse.json({ paymentId, checkoutUrl: updated?.checkoutUrl ?? mockCheckoutUrl });
  }

  // 6. Request a fresh Clover Hosted Checkout session. 7. Correlation
  // metadata is attached inside cloverProvider.createCheckoutSession.
  try {
    const session = await cloverProvider.createCheckoutSession({
      integration,
      amount,
      currency,
      purpose,
      beaconPaymentId: paymentId,
      caseId,
      returnUrl,
      cancelUrl,
    });

    const updated = await updatePaymentRecord(
      organizationId,
      paymentId,
      { providerCheckoutId: session.providerCheckoutId, checkoutUrl: session.checkoutUrl },
      dataAdapterMode,
    );

    // 9. Return only the hosted checkout URL and safe identifiers. 10.
    // Never the integration's own credential — nothing here even holds
    // one in scope by this point (getCloverPrivateKey resolves it
    // on-demand, inside lib/clover/cloverClient.ts, and returns nothing
    // that escapes that function).
    return NextResponse.json({ paymentId, checkoutUrl: updated?.checkoutUrl ?? session.checkoutUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Clover.';
    // The pending record is left as-is (not deleted) — a genuine, visible
    // 'pending' row that never got a real session is better than a
    // silently-vanished attempt. It keeps its placeholder
    // `pending:{id}` providerCheckoutId and null checkoutUrl; a retry with
    // a *new* idempotencyKey (the client's own responsibility once it
    // sees this failure) creates a fresh record and a fresh Clover
    // attempt rather than ever reusing this failed one.
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
