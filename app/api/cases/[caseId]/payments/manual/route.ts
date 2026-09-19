import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { findForbiddenPaymentFields } from '@/lib/paymentFieldGuard';
import { canCollectPayment } from '@/services/authorizationPolicyService';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { createManualSucceededPayment } from '@/services/paymentsService';
import { getActiveCaseOrder } from '@/services/pricingService';
import { markCasePaidIfVerified } from '@/services/paymentWorkflow';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { recordPaymentRecorded } from '@/services/activityService';

/**
 * Manors launch-prep (manual payment recording). Records a payment collected
 * OUTSIDE a card processor — cash, check, or other — against a case's active
 * CaseOrder. Deliberately mirrors the Clover checkout route's own discipline:
 * the request may never carry raw card data (checked anyway, cheap and
 * uniform), the case must belong to the caller's authorized organization, and
 * the amount is validated against the case's own server-resolved balance due
 * — never trusted blindly from the client. Unlike Clover, a manual payment
 * MAY be for less than the full balance (a deposit), since nothing here
 * depends on an external processor's single-charge model.
 *
 * Posts the same Dr Undeposited Funds / Cr Accounts Receivable ledger entry
 * Clover's webhook posts (via `markCasePaidIfVerified`'s existing
 * `financialPosting` path) — no separate accounting logic for "manual" money.
 */
const MAX_PURPOSE_LENGTH = 200;
const MAX_REFERENCE_LENGTH = 100;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const DEFAULT_PURPOSE = 'Case order balance due';
const MANUAL_PAYMENT_METHODS = ['cash', 'check', 'other'] as const;
type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

function isManualPaymentMethod(value: unknown): value is ManualPaymentMethod {
  return typeof value === 'string' && (MANUAL_PAYMENT_METHODS as readonly string[]).includes(value);
}
const METHOD_LABEL: Record<ManualPaymentMethod, string> = { cash: 'Cash', check: 'Check', other: 'Other' };

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

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

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canCollectPayment({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to record payments for this case.' }, { status: 403 });
  }

  if (!isManualPaymentMethod(b.method)) {
    return NextResponse.json({ error: `method is required and must be one of: ${MANUAL_PAYMENT_METHODS.join(', ')}.` }, { status: 400 });
  }
  const method = b.method;
  const reference =
    typeof b.reference === 'string' && b.reference.trim().length > 0 && b.reference.length <= MAX_REFERENCE_LENGTH ? b.reference.trim() : null;
  const purpose =
    typeof b.purpose === 'string' && b.purpose.trim().length > 0 && b.purpose.length <= MAX_PURPOSE_LENGTH ? b.purpose.trim() : DEFAULT_PURPOSE;
  const currency = 'usd';

  if (typeof b.idempotencyKey !== 'string' || b.idempotencyKey.trim().length === 0 || b.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return NextResponse.json({ error: 'idempotencyKey is required and must be a non-empty string.' }, { status: 400 });
  }
  const idempotencyKey = b.idempotencyKey;

  if (typeof b.amountCents !== 'number' || !Number.isInteger(b.amountCents) || b.amountCents <= 0) {
    return NextResponse.json({ error: 'amountCents is required and must be a positive integer number of cents.' }, { status: 400 });
  }
  const requestedAmount = b.amountCents;

  // Confirm the case belongs to this organization (mirrors the Clover
  // checkout route's own direct-collection lookup).
  let caseExists: boolean;
  if (dataAdapterMode === 'mock') {
    caseExists = caseFixtures.some((c) => c.id === caseId && c.organizationId === organizationId && !c.isDeleted);
  } else {
    const response = await queryWixDataItems<WixCaseItem>('cases', {
      filter: { beaconCaseId: caseId, organizationId, isArchived: false },
      paging: { limit: 1 },
    });
    caseExists = mapWixCaseItem(response.dataItems[0]?.data) !== null;
  }
  if (!caseExists) {
    return NextResponse.json({ error: 'Case not found for this organization.' }, { status: 404 });
  }

  const order = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
  if (!order) {
    return NextResponse.json({ error: 'This case has no case order yet — services must be selected first.' }, { status: 422 });
  }
  if (order.balanceDue <= 0) {
    return NextResponse.json({ error: 'This case order has no remaining balance to collect.' }, { status: 400 });
  }
  // A manual payment may be a partial deposit, but never more than what's
  // actually owed — never trusted from the client beyond this bound.
  if (requestedAmount > order.balanceDue) {
    return NextResponse.json({ error: `amountCents cannot exceed the current balance due (${order.balanceDue}).` }, { status: 400 });
  }

  const paymentId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const receiptReference = [METHOD_LABEL[method], reference].filter(Boolean).join(' — ');

  const { record, isNew } = await createManualSucceededPayment(
    {
      id: paymentId,
      organizationId,
      caseId,
      caseOrderId: order.id,
      amount: requestedAmount,
      currency,
      purpose,
      receiptReference,
      idempotencyKey,
      initiatedByStaffProfileId: (await resolveStaffProfileForCaller({ organizationId, userId, role }, dataAdapterMode))?.id ?? null,
      createdAt: nowIso,
    },
    dataAdapterMode,
  );

  if (!isNew) {
    // Already recorded by an earlier request with this exact idempotencyKey
    // — return it as-is rather than posting the ledger entry a second time.
    return NextResponse.json({ payment: record });
  }

  const activityCtx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: paymentId };

  await markCasePaidIfVerified(organizationId, caseId, dataAdapterMode, {
    paymentId: record.id,
    amountCents: record.amount,
    ctx: activityCtx,
    idFactory: () => crypto.randomUUID(),
  });

  try {
    await recordPaymentRecorded(activityCtx, caseId, record.id, record.amount, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record payment.recorded activity event:', error instanceof Error ? error.message : error);
  }

  return NextResponse.json({ payment: record }, { status: 201 });
}
