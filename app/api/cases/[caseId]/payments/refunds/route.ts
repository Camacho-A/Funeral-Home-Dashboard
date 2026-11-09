import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { runAfterResponse } from '@/lib/afterResponse';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { findForbiddenPaymentFields } from '@/lib/paymentFieldGuard';
import { canRefundPayment } from '@/services/authorizationPolicyService';
import { loadCaseOnServer } from '@/services/serverCaseLoader';
import { createManualRefundRecord, listPaymentRecordsForCase } from '@/services/paymentsService';
import { getActiveCaseOrder, getSatisfiedAmountForCase, refreshBalanceForCase } from '@/services/pricingService';
import { postCaseRefundTransaction } from '@/services/financialTransactionService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { recordCaseRefundIssued } from '@/services/activityService';
import { regenerateBillingDocuments } from '@/services/automaticBillingDocuments';
import { MANUAL_PAYMENT_METHODS, MANUAL_PAYMENT_METHOD_LABEL, isManualPaymentMethod, looksLikeCardNumber } from '@/domain/billing/manualPaymentMethods';
import {
  CASE_REFUND_KINDS,
  CASE_REFUND_KIND_LABEL,
  CASE_REFUND_PURPOSE,
  isCaseRefundKind,
  maxRefundCents,
  netPaidCents,
  refundTooLargeMessage,
} from '@/domain/billing/caseRefunds';

/**
 * Case refunds (2026-11). Records a refund staff have already given back
 * to the family — cash, check, a card refund at the terminal — exactly as
 * Record Payment records money already collected. Nothing is charged or
 * refunded at a processor from here.
 *
 * Archived cases are allowed on purpose: a refund usually comes after the
 * case is complete, and completed cases archive themselves. Only the
 * refund (and the Receipt of Payment it regenerates) is written — the
 * case row itself is never touched, so it stays archived and locked.
 *
 * The amount is checked against the case's own server-side figures, never
 * trusted from the client (domain/billing/caseRefunds.ts#maxRefundCents),
 * so a refund can never reopen a balance on the case.
 */
const MAX_REFERENCE_LENGTH = 100;
const MAX_REASON_LENGTH = 300;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

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

  if (!(await canRefundPayment({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to record refunds.' }, { status: 403 });
  }

  if (!isCaseRefundKind(b.kind)) {
    return NextResponse.json({ error: `kind is required and must be one of: ${CASE_REFUND_KINDS.join(', ')}.` }, { status: 400 });
  }
  const kind = b.kind;
  if (!isManualPaymentMethod(b.method)) {
    return NextResponse.json({ error: `method is required and must be one of: ${MANUAL_PAYMENT_METHODS.join(', ')}.` }, { status: 400 });
  }
  const method = b.method;
  const reference =
    typeof b.reference === 'string' && b.reference.trim().length > 0 && b.reference.length <= MAX_REFERENCE_LENGTH ? b.reference.trim() : null;
  if (method === 'credit_card' && reference && looksLikeCardNumber(reference)) {
    return NextResponse.json(
      { error: 'Do not enter a card number. Use an approval code or receipt number, or leave the reference blank.' },
      { status: 400 },
    );
  }
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
    return NextResponse.json({ error: `Enter a reason for the refund (up to ${MAX_REASON_LENGTH} characters).` }, { status: 400 });
  }
  if (typeof b.idempotencyKey !== 'string' || b.idempotencyKey.trim().length === 0 || b.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return NextResponse.json({ error: 'idempotencyKey is required and must be a non-empty string.' }, { status: 400 });
  }
  const idempotencyKey = b.idempotencyKey;
  if (typeof b.amountCents !== 'number' || !Number.isInteger(b.amountCents) || b.amountCents <= 0) {
    return NextResponse.json({ error: 'amountCents is required and must be a positive integer number of cents.' }, { status: 400 });
  }
  const amountCents = b.amountCents;

  // Archived cases included (see the file comment); another organization's
  // case is simply not found.
  const case_ = await loadCaseOnServer(organizationId, caseId, dataAdapterMode);
  if (!case_) {
    return NextResponse.json({ error: 'Case not found for this organization.' }, { status: 404 });
  }

  const order = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
  if (!order) {
    return NextResponse.json({ error: 'This case has no case order, so there is nothing to refund.' }, { status: 422 });
  }

  const [payments, satisfiedCents] = await Promise.all([
    listPaymentRecordsForCase(organizationId, caseId, dataAdapterMode),
    getSatisfiedAmountForCase(organizationId, caseId, dataAdapterMode),
  ]);
  const max = maxRefundCents({ kind, orderTotalCents: order.total, netPaidCents: netPaidCents(payments), satisfiedCents });
  if (amountCents > max) {
    // A retry of a refund already recorded is answered below, not refused here.
    const already = payments.find((p) => p.idempotencyKey === `${organizationId}:${idempotencyKey}`);
    if (already) return NextResponse.json({ refund: already });
    return NextResponse.json({ error: refundTooLargeMessage(kind, max), maxRefundCents: max }, { status: 400 });
  }

  const refundId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const methodReference = [MANUAL_PAYMENT_METHOD_LABEL[method], reference].filter(Boolean).join(' — ');
  const staffProfileId = (await resolveStaffProfileForCaller({ organizationId, userId, role }, dataAdapterMode))?.id ?? null;

  const { record, isNew } = await createManualRefundRecord(
    {
      id: refundId,
      organizationId,
      caseId,
      caseOrderId: order.id,
      amount: amountCents,
      currency: 'usd',
      purpose: CASE_REFUND_PURPOSE[kind],
      receiptReference: methodReference,
      idempotencyKey,
      initiatedByStaffProfileId: staffProfileId,
      createdAt: nowIso,
    },
    dataAdapterMode,
  );
  if (!isNew) {
    // Already recorded by an earlier request with this idempotencyKey — the
    // ledger entry is not posted a second time.
    return NextResponse.json({ refund: record });
  }

  const activityCtx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: refundId };

  await postCaseRefundTransaction(
    organizationId,
    {
      caseId,
      refundId: record.id,
      amountCents,
      kind,
      memo: `Refund ${record.id} — ${CASE_REFUND_KIND_LABEL[kind]}`,
      postedByStaffProfileId: staffProfileId,
      idFactory: () => crypto.randomUUID(),
    },
    activityCtx,
    dataAdapterMode,
  );
  await refreshBalanceForCase(organizationId, caseId, dataAdapterMode);

  try {
    await recordCaseRefundIssued(
      activityCtx,
      caseId,
      { id: record.id, amountCents, kindLabel: CASE_REFUND_KIND_LABEL[kind], methodReference, reason },
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record the refund activity event:', error instanceof Error ? error.message : error);
  }

  // The Receipt of Payment (and the Statement's "payments received") now
  // show the refund — regenerated after the response, as after a payment.
  runAfterResponse(`billing documents for case ${caseId}`, () =>
    regenerateBillingDocuments({ caseId, trigger: 'refund_recorded' }, activityCtx, dataAdapterMode),
  );

  return NextResponse.json({ refund: record }, { status: 201 });
}
