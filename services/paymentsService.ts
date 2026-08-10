import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, WixDataApiError } from '../lib/wixDataApi';
import {
  mapWixPaymentIntegrationItem,
  buildWixPaymentIntegrationData,
  type WixPaymentIntegrationItem,
} from '../lib/wixPaymentIntegrationMapper';
import {
  mapWixPaymentRecordItem,
  buildWixPaymentRecordData,
  applyPaymentRecordUpdateToWixData,
  type WixPaymentRecordItem,
} from '../lib/wixPaymentRecordMapper';
import {
  mapWixWebhookEventItem,
  buildWixWebhookEventData,
  applyWebhookEventUpdateToWixData,
  type WixWebhookEventItem,
} from '../lib/wixWebhookEventMapper';
import type { PaymentIntegration, PaymentRecord } from '../types/payment';
import type { WebhookEventRecord } from '../types/webhookEvent';
import { paymentIntegrationFixtures, paymentRecordFixtures, webhookEventFixtures } from './__mocks__/paymentFixtures';
import type { PaymentProvider, RefundResult } from '../lib/paymentProvider';
import { cloverProvider } from '../lib/clover/cloverProvider';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Same organization-scoped,
 * `dataAdapterMode`-branching shape as casesService.ts — mock mode mutates
 * services/__mocks__/paymentFixtures.ts's in-memory arrays directly and
 * never reaches lib/clover/* at all; wix mode reads/writes the real
 * `paymentIntegrations`/`paymentRecords`/`webhookEvents` collections and is
 * the only mode that ever calls the real Clover API. See
 * docs/adr/ADR-022-clover-hosted-checkout-integration.md.
 *
 * Wix's HTTP 409 for a unique-index/duplicate-`_id` conflict — confirmed
 * empirically against the live `paymentRecords` collection (error codes
 * `WDE0123`/`WDE0074`) — is the correctness backbone of both
 * `createIdempotentPendingPaymentRecord` and `claimWebhookEvent`
 * below: "insert, and if it conflicts, treat that as the real answer"
 * rather than "check first, then insert" (which races under concurrent
 * requests — the exact gap this correction pass closes).
 */

const WIX_CONFLICT_STATUS = 409;

function isWixConflict(error: unknown): boolean {
  return error instanceof WixDataApiError && error.status === WIX_CONFLICT_STATUS;
}

/**
 * Onboards one organization's PaymentIntegration row — there is no admin
 * UI for this in Phase 19B (Manor's Cremation's sandbox row was created
 * directly against Wix; see docs/WIX_DATA_SCHEMA.md), but the function
 * exists as the one supported way to do it programmatically, exercised by
 * tests and available to a future onboarding script or admin surface.
 */
export async function createPaymentIntegration(
  integration: PaymentIntegration,
  dataAdapterMode: DataAdapterMode,
): Promise<PaymentIntegration> {
  if (dataAdapterMode === 'mock') {
    paymentIntegrationFixtures.push(integration);
    return integration;
  }

  const inserted = await insertWixDataItem<WixPaymentIntegrationItem>(
    'paymentIntegrations',
    buildWixPaymentIntegrationData(integration),
    integration.id,
  );
  const mapped = mapWixPaymentIntegrationItem(inserted.data);
  if (!mapped) throw new Error('Failed to create payment integration.');
  return mapped;
}

export async function getEnabledIntegration(
  organizationId: string,
  provider: string,
  dataAdapterMode: DataAdapterMode,
): Promise<PaymentIntegration | null> {
  if (dataAdapterMode === 'mock') {
    return (
      paymentIntegrationFixtures.find(
        (i) => i.organizationId === organizationId && i.provider === provider && i.isEnabled,
      ) ?? null
    );
  }

  const response = await queryWixDataItems<WixPaymentIntegrationItem>('paymentIntegrations', {
    filter: { organizationId, provider },
    paging: { limit: 1 },
  });
  const integration = mapWixPaymentIntegrationItem(response.dataItems[0]?.data);
  return integration && integration.isEnabled ? integration : null;
}

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Same lookup as
 * `getEnabledIntegration`, but regardless of `isEnabled` — used by
 * `services/organizationProvisioningService.ts`'s
 * `createPaymentIntegrationPlaceholder` to idempotently detect "does this
 * organization already have a (possibly still-disabled) integration row"
 * without `getEnabledIntegration`'s own enabled-only filter hiding the
 * very placeholder row onboarding itself creates.
 */
export async function getIntegration(
  organizationId: string,
  provider: string,
  dataAdapterMode: DataAdapterMode,
): Promise<PaymentIntegration | null> {
  if (dataAdapterMode === 'mock') {
    return paymentIntegrationFixtures.find((i) => i.organizationId === organizationId && i.provider === provider) ?? null;
  }

  const response = await queryWixDataItems<WixPaymentIntegrationItem>('paymentIntegrations', {
    filter: { organizationId, provider },
    paging: { limit: 1 },
  });
  return mapWixPaymentIntegrationItem(response.dataItems[0]?.data);
}

export async function listPaymentRecordsForCase(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<PaymentRecord[]> {
  if (dataAdapterMode === 'mock') {
    return paymentRecordFixtures
      .filter((p) => p.organizationId === organizationId && p.caseId === caseId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  const response = await queryWixDataItems<WixPaymentRecordItem>('paymentRecords', {
    filter: { organizationId, caseId },
  });
  return response.dataItems
    .map((item) => mapWixPaymentRecordItem(item.data))
    .filter((p): p is PaymentRecord => p !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getPaymentRecordById(
  organizationId: string,
  paymentId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<PaymentRecord | null> {
  if (dataAdapterMode === 'mock') {
    return paymentRecordFixtures.find((p) => p.organizationId === organizationId && p.id === paymentId) ?? null;
  }

  const response = await queryWixDataItems<WixPaymentRecordItem>('paymentRecords', {
    filter: { organizationId, beaconPaymentId: paymentId },
    paging: { limit: 1 },
  });
  return mapWixPaymentRecordItem(response.dataItems[0]?.data);
}

/**
 * Webhook correlation: Clover's event names only a checkout session id
 * and a merchantId — never Beacon's organizationId. This looks the
 * record up by providerCheckoutId alone (a Clover-issued UUID, unique
 * regardless of organization); the caller (the webhook route) is
 * responsible for then confirming the resolved record's own organization
 * has a PaymentIntegration whose merchantId matches the webhook's — the
 * "enforce organization and merchant isolation" requirement — before
 * applying any update.
 */
export async function findPaymentRecordByCheckoutId(
  provider: string,
  providerCheckoutId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<PaymentRecord | null> {
  if (dataAdapterMode === 'mock') {
    return paymentRecordFixtures.find((p) => p.provider === provider && p.providerCheckoutId === providerCheckoutId) ?? null;
  }

  const response = await queryWixDataItems<WixPaymentRecordItem>('paymentRecords', {
    filter: { provider, providerCheckoutId },
    paging: { limit: 1 },
  });
  return mapWixPaymentRecordItem(response.dataItems[0]?.data);
}

/**
 * Looks up a PaymentRecord by its composed idempotency key
 * (`{organizationId}:{clientKey}` — see types/payment.ts's own comment on
 * why the value is composed this way rather than a genuine compound
 * index, which Wix Data does not support). Used both as the mock-mode
 * pre-check and, in wix mode, to fetch the winning record after a 409
 * conflict on insert.
 */
export async function findPaymentRecordByIdempotencyKey(
  organizationId: string,
  idempotencyKey: string,
  dataAdapterMode: DataAdapterMode,
): Promise<PaymentRecord | null> {
  const storedKey = `${organizationId}:${idempotencyKey}`;
  if (dataAdapterMode === 'mock') {
    return paymentRecordFixtures.find((p) => p.organizationId === organizationId && p.idempotencyKey === storedKey) ?? null;
  }

  const response = await queryWixDataItems<WixPaymentRecordItem>('paymentRecords', {
    filter: { organizationId, idempotencyKey: storedKey },
    paging: { limit: 1 },
  });
  return mapWixPaymentRecordItem(response.dataItems[0]?.data);
}

/**
 * Creates a new pending PaymentRecord, or — if a record already exists
 * for this organization+idempotencyKey — returns that existing record
 * instead of creating a duplicate. This is the atomic guard the
 * application-level "check, then insert" pattern couldn't provide:
 * concurrent duplicate requests race to insert, exactly one wins (Wix's
 * real unique index enforces this, not a prior read), and the loser is
 * handed the winner's record rather than erroring.
 *
 * `providerCheckoutId` is seeded with a placeholder unique to this
 * record's own id (`pending:{id}`), never an empty string — confirmed
 * empirically that Wix's unique index on `providerCheckoutId` treats two
 * empty-string values as a conflict exactly like any other duplicate
 * (error `WDE0123`), which would have made it impossible for more than
 * one payment to ever be awaiting its first Clover session at once.
 *
 * Mock mode has no real unique index, so uniqueness is enforced with a
 * plain check-before-insert here — safe in mock mode's single-threaded,
 * non-durable context (see services/__mocks__/paymentFixtures.ts's own
 * comment), unlike the wix-mode path this function otherwise mirrors.
 */
export async function createIdempotentPendingPaymentRecord(
  params: {
    id: string;
    organizationId: string;
    caseId: string;
    caseOrderId?: string | null;
    provider: string;
    amount: number;
    currency: string;
    purpose: string;
    idempotencyKey: string;
    createdAt: string;
    /** Phase 31 (Financial Management & General Ledger). StaffProfile-space
        — set only when a real staff-initiated checkout resolved a caller
        (never a family/Portal-initiated payment). Optional so every
        pre-existing call site keeps compiling unchanged. */
    initiatedByStaffProfileId?: string | null;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<{ record: PaymentRecord; isNew: boolean }> {
  const storedIdempotencyKey = `${params.organizationId}:${params.idempotencyKey}`;

  const record: PaymentRecord = {
    id: params.id,
    organizationId: params.organizationId,
    caseId: params.caseId,
    caseOrderId: params.caseOrderId ?? null,
    provider: params.provider,
    providerCheckoutId: `pending:${params.id}`,
    providerPaymentId: null,
    idempotencyKey: storedIdempotencyKey,
    checkoutUrl: null,
    status: 'pending',
    amount: params.amount,
    currency: params.currency,
    purpose: params.purpose,
    cardBrand: null,
    cardLast4: null,
    receiptReference: null,
    failureCode: null,
    failureMessage: null,
    createdAt: params.createdAt,
    paidAt: null,
    updatedAt: params.createdAt,
    initiatedByStaffProfileId: params.initiatedByStaffProfileId ?? null,
    depositedInBankDepositId: null,
  };

  if (dataAdapterMode === 'mock') {
    const existing = await findPaymentRecordByIdempotencyKey(params.organizationId, params.idempotencyKey, dataAdapterMode);
    if (existing) return { record: existing, isNew: false };
    paymentRecordFixtures.push(record);
    return { record, isNew: true };
  }

  try {
    const inserted = await insertWixDataItem<WixPaymentRecordItem>(
      'paymentRecords',
      buildWixPaymentRecordData(record),
      record.id,
    );
    const mapped = mapWixPaymentRecordItem(inserted.data);
    if (!mapped) throw new Error('Failed to create payment record.');
    return { record: mapped, isNew: true };
  } catch (error) {
    if (!isWixConflict(error)) throw error;
    const existing = await findPaymentRecordByIdempotencyKey(params.organizationId, params.idempotencyKey, dataAdapterMode);
    if (!existing) throw error; // conflict but no matching record found — surface the real error rather than mask it
    return { record: existing, isNew: false };
  }
}

const paymentProvider: PaymentProvider = cloverProvider;

/**
 * Phase 31 (Financial Management & General Ledger). Refunds an already-
 * succeeded payment at its provider — the one place any file needs to
 * touch `PaymentProvider.refundPayment`, mirroring `initiateCheckout`'s
 * own "no direct payment-provider-calling code outside this module"
 * boundary. Called from
 * services/financialTransactionService.ts#postRefundTransaction, which
 * has already loaded the `PaymentRecord` and never imports
 * `lib/clover/cloverProvider.ts` itself.
 *
 * Mock mode never reaches the real provider — mirrors `initiateCheckout`'s
 * own mock-mode branch (a synthesized result, not a real Clover call).
 */
export async function refundPaymentAtProvider(
  organizationId: string,
  payment: PaymentRecord,
  dataAdapterMode: DataAdapterMode,
): Promise<RefundResult> {
  if (!payment.providerPaymentId) {
    throw new Error(`Payment "${payment.id}" has no providerPaymentId — cannot be refunded at the provider.`);
  }
  if (dataAdapterMode === 'mock') {
    return { providerRefundId: `mock-refund-${payment.id}` };
  }
  const integration = await getEnabledIntegration(organizationId, payment.provider, dataAdapterMode);
  if (!integration) {
    throw new Error(`No enabled "${payment.provider}" payment integration for this organization.`);
  }
  return paymentProvider.refundPayment({
    integration,
    providerPaymentId: payment.providerPaymentId,
    amount: payment.amount,
  });
}

export type InitiateCheckoutResult = { paymentId: string; checkoutUrl: string | null; isNew: boolean };

/**
 * Phase 29 (Family Portal & External Collaboration). Extracts the Clover
 * Hosted Checkout orchestration `app/api/cases/[caseId]/payments/clover/checkout/route.ts`
 * has always performed inline into a reusable, testable function — added
 * so `services/portal/portalPaymentService.ts` can initiate a family
 * checkout without ever importing `lib/clover/cloverProvider.ts` itself
 * (the "no direct payment-provider-calling code" structural boundary; see
 * `documentService.ts`'s own `documentRenderer`/`documentStorageProvider`
 * binding for the identical pattern this mirrors).
 *
 * Purely additive: the existing staff checkout route is untouched and
 * keeps its own inline logic exactly as shipped — this is a new function
 * alongside it, not a refactor of it, so there is zero behavior-change
 * risk to the already-tested staff flow. A future cleanup could point
 * that route at this function too, but that's a deliberate choice for
 * later, not bundled into this phase.
 *
 * Mirrors the route's own sequencing exactly: confirm the provider is
 * enabled, create-or-reuse the idempotent pending record, then (mock mode)
 * synthesize a local return-page URL or (real mode) request an actual
 * Clover session and persist its checkoutUrl/providerCheckoutId.
 */
export async function initiateCheckout(
  params: {
    organizationId: string;
    caseId: string;
    caseOrderId: string;
    provider: string;
    amount: number;
    currency: string;
    purpose: string;
    idempotencyKey: string;
    paymentId: string;
    returnUrl: string;
    cancelUrl: string;
    now?: string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<InitiateCheckoutResult> {
  const integration = await getEnabledIntegration(params.organizationId, params.provider, dataAdapterMode);
  if (!integration) {
    throw new Error(`${params.provider} is not enabled for this organization.`);
  }

  const createdAt = params.now ?? new Date().toISOString();
  const { record: pendingRecord, isNew } = await createIdempotentPendingPaymentRecord(
    {
      id: params.paymentId,
      organizationId: params.organizationId,
      caseId: params.caseId,
      caseOrderId: params.caseOrderId,
      provider: params.provider,
      amount: params.amount,
      currency: params.currency,
      purpose: params.purpose,
      idempotencyKey: params.idempotencyKey,
      createdAt,
    },
    dataAdapterMode,
  );

  if (!isNew) {
    return { paymentId: pendingRecord.id, checkoutUrl: pendingRecord.checkoutUrl, isNew: false };
  }

  if (dataAdapterMode === 'mock') {
    const mockCheckoutUrl = `${params.returnUrl}&mock=1`;
    const updated = await updatePaymentRecord(
      params.organizationId,
      params.paymentId,
      { providerCheckoutId: `mock-checkout-${params.paymentId}`, checkoutUrl: mockCheckoutUrl },
      dataAdapterMode,
    );
    return { paymentId: params.paymentId, checkoutUrl: updated?.checkoutUrl ?? mockCheckoutUrl, isNew: true };
  }

  const session = await paymentProvider.createCheckoutSession({
    integration,
    amount: params.amount,
    currency: params.currency,
    purpose: params.purpose,
    beaconPaymentId: params.paymentId,
    caseId: params.caseId,
    returnUrl: params.returnUrl,
    cancelUrl: params.cancelUrl,
  });
  const updated = await updatePaymentRecord(
    params.organizationId,
    params.paymentId,
    { providerCheckoutId: session.providerCheckoutId, checkoutUrl: session.checkoutUrl },
    dataAdapterMode,
  );
  return { paymentId: params.paymentId, checkoutUrl: updated?.checkoutUrl ?? session.checkoutUrl, isNew: true };
}

/**
 * A stale 'processing' claim (a prior attempt that started but never
 * reached a terminal state — most likely the process crashed or was
 * killed mid-request) is eligible for reclaim after this long. Generous
 * relative to how long webhook processing actually takes (single-digit
 * Wix Data round trips, well under a second in practice) — chosen to
 * avoid ever reclaiming a claim that's still genuinely, actively being
 * processed.
 */
const STALE_PROCESSING_TIMEOUT_MS = 2 * 60 * 1000;

export type WebhookClaimResult =
  | { outcome: 'claimed' }
  | { outcome: 'already-completed' }
  | { outcome: 'currently-processing' };

async function getWebhookEvent(fingerprint: string, dataAdapterMode: DataAdapterMode): Promise<WebhookEventRecord | null> {
  if (dataAdapterMode === 'mock') {
    return webhookEventFixtures.get(fingerprint) ?? null;
  }
  const response = await queryWixDataItems<WixWebhookEventItem>('webhookEvents', {
    filter: { _id: fingerprint },
    paging: { limit: 1 },
  });
  const item = response.dataItems[0];
  return item ? mapWixWebhookEventItem(fingerprint, item.data) : null;
}

/**
 * Durable webhook-delivery dedup AND processing-lifecycle tracking — see
 * lib/wixWebhookEventMapper.ts's/types/webhookEvent.ts's own comments for
 * the full design and docs/adr/ADR-022-clover-hosted-checkout-integration.md
 * for why a bare presence check (the previous design) was insufficient: it
 * could permanently "claim" a fingerprint whose downstream PaymentRecord
 * update then failed, silently swallowing every subsequent retry.
 *
 * The *initial* claim (a brand-new fingerprint) is fully atomic — Wix's
 * `_id` uniqueness enforces it, not a prior read, so it's correct even
 * under genuine concurrency and across server instances/restarts.
 * Reclaiming a 'failed' or stale 'processing' event is a best-effort
 * read-then-update (Wix Data has no compare-and-swap primitive) — safe in
 * practice because the downstream `PaymentRecord.status` transition
 * remains its own idempotent guard regardless (see
 * app/api/webhooks/clover/route.ts): a race here can at worst cause a
 * harmless duplicate reprocessing attempt, never an incorrect final
 * payment state.
 *
 * Throws (never silently returns a "safe" outcome) if the initial insert
 * attempt fails for any reason other than a genuine duplicate-key
 * conflict — e.g. a real Wix/network failure — so the caller's own
 * try/catch is what decides the HTTP response; a database failure here
 * must never be mistaken for "this event is a known duplicate."
 */
export async function claimWebhookEvent(
  fingerprint: string,
  metadata: { provider: string; providerCheckoutId: string },
  dataAdapterMode: DataAdapterMode,
): Promise<WebhookClaimResult> {
  const nowIso = new Date().toISOString();
  const freshClaim: WebhookEventRecord = {
    fingerprint,
    provider: metadata.provider,
    providerCheckoutId: metadata.providerCheckoutId,
    state: 'processing',
    attemptCount: 1,
    firstReceivedAt: nowIso,
    lastAttemptAt: nowIso,
    completedAt: null,
  };

  if (dataAdapterMode === 'mock') {
    const existing = webhookEventFixtures.get(fingerprint);
    if (!existing) {
      webhookEventFixtures.set(fingerprint, freshClaim);
      return { outcome: 'claimed' };
    }
    return reconcileExistingClaim(existing, dataAdapterMode);
  }

  try {
    await insertWixDataItem('webhookEvents', buildWixWebhookEventData(freshClaim), fingerprint);
    return { outcome: 'claimed' };
  } catch (error) {
    if (!isWixConflict(error)) throw error; // a real failure — never silently treated as "already handled"
    const existing = await getWebhookEvent(fingerprint, dataAdapterMode);
    if (!existing) throw error; // conflict but no matching record found — surface the real error rather than mask it
    return reconcileExistingClaim(existing, dataAdapterMode);
  }
}

async function reconcileExistingClaim(
  existing: WebhookEventRecord,
  dataAdapterMode: DataAdapterMode,
): Promise<WebhookClaimResult> {
  if (existing.state === 'completed') {
    return { outcome: 'already-completed' };
  }

  if (existing.state === 'processing') {
    const isStale = Date.now() - new Date(existing.lastAttemptAt).getTime() > STALE_PROCESSING_TIMEOUT_MS;
    if (!isStale) return { outcome: 'currently-processing' };
    // stale — fall through to reclaim below
  }

  // existing.state === 'failed', or a stale 'processing' claim: reclaim it.
  const nowIso = new Date().toISOString();
  await updateWebhookEventRecord(
    existing.fingerprint,
    { state: 'processing', attemptCount: existing.attemptCount + 1, lastAttemptAt: nowIso },
    dataAdapterMode,
  );
  return { outcome: 'claimed' };
}

async function updateWebhookEventRecord(
  fingerprint: string,
  patch: Partial<WebhookEventRecord>,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const existing = webhookEventFixtures.get(fingerprint);
    if (!existing) return;
    webhookEventFixtures.set(fingerprint, { ...existing, ...patch });
    return;
  }

  const response = await queryWixDataItems<WixWebhookEventItem>('webhookEvents', {
    filter: { _id: fingerprint },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return;

  const mergedData = applyWebhookEventUpdateToWixData(existingItem.data, patch);
  await updateWixDataItem('webhookEvents', existingItem.id, mergedData);
}

/** Marks a claimed event completed — only ever called after its
    PaymentRecord update has actually succeeded. */
export async function markWebhookEventCompleted(fingerprint: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  const nowIso = new Date().toISOString();
  await updateWebhookEventRecord(fingerprint, { state: 'completed', completedAt: nowIso, lastAttemptAt: nowIso }, dataAdapterMode);
}

/** Marks a claimed event failed — a future retry of the identical
    fingerprint (Clover redelivering after a non-2xx response) will
    reclaim and retry it, never treat it as an already-handled duplicate. */
export async function markWebhookEventFailed(fingerprint: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  await updateWebhookEventRecord(fingerprint, { state: 'failed', lastAttemptAt: new Date().toISOString() }, dataAdapterMode);
}

export async function updatePaymentRecord(
  organizationId: string,
  paymentId: string,
  patch: Partial<PaymentRecord>,
  dataAdapterMode: DataAdapterMode,
): Promise<PaymentRecord | null> {
  if (dataAdapterMode === 'mock') {
    const index = paymentRecordFixtures.findIndex((p) => p.organizationId === organizationId && p.id === paymentId);
    if (index === -1) return null;
    paymentRecordFixtures[index] = { ...paymentRecordFixtures[index], ...patch };
    return paymentRecordFixtures[index];
  }

  const response = await queryWixDataItems<WixPaymentRecordItem>('paymentRecords', {
    filter: { organizationId, beaconPaymentId: paymentId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;

  const mergedData = applyPaymentRecordUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixPaymentRecordItem>('paymentRecords', existingItem.id, mergedData);
  return mapWixPaymentRecordItem(updated.data);
}

/**
 * Same shape as updatePaymentRecord, but looked up by providerCheckoutId
 * rather than Beacon's own id — the webhook route's one write path, used
 * only after it has independently verified the resolved record's
 * organization/merchant match the event (see findPaymentRecordByCheckoutId's
 * own comment).
 */
export async function updatePaymentRecordByCheckoutId(
  organizationId: string,
  providerCheckoutId: string,
  patch: Partial<PaymentRecord>,
  dataAdapterMode: DataAdapterMode,
): Promise<PaymentRecord | null> {
  if (dataAdapterMode === 'mock') {
    const index = paymentRecordFixtures.findIndex(
      (p) => p.organizationId === organizationId && p.providerCheckoutId === providerCheckoutId,
    );
    if (index === -1) return null;
    paymentRecordFixtures[index] = { ...paymentRecordFixtures[index], ...patch };
    return paymentRecordFixtures[index];
  }

  const response = await queryWixDataItems<WixPaymentRecordItem>('paymentRecords', {
    filter: { organizationId, providerCheckoutId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;

  const mergedData = applyPaymentRecordUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixPaymentRecordItem>('paymentRecords', existingItem.id, mergedData);
  return mapWixPaymentRecordItem(updated.data);
}
