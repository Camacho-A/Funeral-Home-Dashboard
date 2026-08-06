import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { checkRateLimit } from '@/lib/rateLimiter';
import { initiateFamilyCheckout, PortalPaymentServiceError } from '@/services/portal/portalPaymentService';

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const RATE_LIMIT_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Phase 29 (Family Portal & External Collaboration). Requires
 * `payment.pay`. The amount charged is always the case's active
 * `CaseOrder.balanceDue`, resolved server-side — a request body naming
 * an `amount` field is rejected outright, mirroring the staff-side
 * checkout route's own invariant exactly. Rate-limited per
 * `(portalUserId, caseId)` — refinement #13's own named basic limit for
 * payment-checkout initiation.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'payment.pay');
  if (!accessResult.authorized) return accessResult.response;

  const rateLimit = checkRateLimit(`family-payment-checkout:${accessResult.portalUser.id}:${accessResult.caseId}`, RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if ('amount' in b) {
    return NextResponse.json({ error: "amount must not be supplied — the balance due on this case's current CaseOrder is always used." }, { status: 400 });
  }
  if (typeof b.idempotencyKey !== 'string' || b.idempotencyKey.trim().length === 0 || b.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return NextResponse.json({ error: 'idempotencyKey is required and must be a non-empty string.' }, { status: 400 });
  }

  // Generated before the return/cancel URLs so both can embed it — the
  // family return page needs paymentId to know which PaymentRecord to
  // poll after the browser comes back from checkout, mirroring the staff
  // Clover checkout route's own identical sequencing.
  const paymentId = crypto.randomUUID();
  const origin = new URL(request.url).origin;
  const returnUrl = `${origin}/family/cases/${accessResult.caseId}/payments/return?paymentId=${paymentId}&outcome=success`;
  const cancelUrl = `${origin}/family/cases/${accessResult.caseId}/payments/return?paymentId=${paymentId}&outcome=cancel`;

  try {
    const result = await initiateFamilyCheckout(
      { organizationId: accessResult.organizationId, caseId: accessResult.caseId, idempotencyKey: b.idempotencyKey, returnUrl, cancelUrl, paymentId },
      accessResult.dataAdapterMode,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PortalPaymentServiceError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
