import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { getAppBaseUrl } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixSignatureRequestItem,
  buildWixSignatureRequestData,
  applySignatureRequestPatchToWixData,
  type WixSignatureRequestItem,
} from '../lib/wixSignatureRequestMapper';
import { mapWixSignatureRecordItem, buildWixSignatureRecordData, type WixSignatureRecordItem } from '../lib/wixSignatureRecordMapper';
import { mapWixCaseItem, type WixCaseItem } from '../lib/wixCaseMapper';
import type { SignatureRequest, SignatureRequestStatus, NewSignatureRequestInput } from '../types/signatureRequest';
import type { SignatureRecord } from '../types/signatureRecord';
import type { Case } from '../types/case';
import { generateToken, hashToken } from '../lib/identity/tokens';
import { identityMessageSignatureNotifier } from '../lib/identityMessageSignatureNotifier';
import type { SignatureNotifier } from '../lib/signatureNotifier';
import { list as listCaseDocuments, downloadFile as downloadCaseDocumentFile, markDocumentSigned, resolveMergeSourceData } from './documentService';
import { createNotification } from './notificationService';
import {
  recordSignatureRequested,
  recordSignatureEmailSent,
  recordSignatureViewed,
  recordSignatureCompleted,
  recordSignatureDeclined,
  recordSignatureCancelled,
  recordSignatureExpired,
  type ActivityContext,
} from './activityService';
import { signatureRequestFixtures, signatureRecordFixtures } from './__mocks__/documentFixtures';
import { caseFixtures } from './__mocks__/fixtures';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows).
 * **`SignatureService`** — the single orchestration layer for everything
 * that touches a `SignatureRequest`/`SignatureRecord`'s lifecycle: token
 * generation/validation, the request's own status machine, document
 * locking (via `documentService.ts`'s `markDocumentSigned`), every
 * `ActivityEvent`, and every notification. No Route Handler ever
 * validates a signing token, flips `CaseDocument.signatureStatus`, calls
 * an `activityService.recordSignature*` helper, or imports
 * `lib/identityMessageSignatureNotifier.ts` directly — only this file
 * does. `services/signatureService.test.ts`'s own structural test
 * asserts this (mirroring `services/documentService.test.ts`'s own
 * import-boundary test exactly).
 *
 * The concrete notifier is imported directly (matching every provider in
 * this codebase — no factory function anywhere), but every function
 * below is typed against the neutral `SignatureNotifier` interface —
 * swapping it later is a new file + one import line, no change to the
 * logic below.
 *
 * **Invariants** (see docs/adr/ADR-030-electronic-signatures-and-authorization-workflows.md):
 * a `SignatureRequest`'s `status` may change; a `SignatureRecord`, once
 * created, is never modified or deleted. A signed document is
 * permanently locked (enforced in `documentService.ts`'s `generate()`,
 * not here). At most one active (`draft`/`pending`/`viewed`) request
 * exists per document at a time. The raw signing token is never
 * persisted, logged, or returned after the call that issues/rotates it.
 */

const signatureNotifier: SignatureNotifier = identityMessageSignatureNotifier;

export class SignatureServiceError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

const DEFAULT_EXPIRATION_DAYS = 30;

function defaultExpiresAt(fromIso: string): string {
  const date = new Date(fromIso);
  date.setUTCDate(date.getUTCDate() + DEFAULT_EXPIRATION_DAYS);
  return date.toISOString();
}

function buildSigningLink(rawToken: string): string {
  return `${getAppBaseUrl()}/sign?token=${encodeURIComponent(rawToken)}`;
}

/** Every action a *signer* (never a Beacon session-holder) performs —
    view/complete/decline — is attributed this way: `actorIdentityId`
    is null only because `isSystemGenerated` is true here (the one valid
    combination per `types/activityEvent.ts`'s own comment), even though
    a real external human, not an automated process, triggered it. The
    event's own `description` (built by each `recordSignature*` helper)
    carries the real narrative — "Signed by Jane Doe" — so this is never
    confused with genuine background automation by anyone reading the
    audit trail. Reuses the request's own `correlationId` rather than
    minting a new one, since every event across one request's entire
    lifecycle is meant to share it (see `SignatureRequest.correlationId`'s
    own comment). */
function signerActivityContext(organizationId: string, correlationId: string): ActivityContext {
  return { organizationId, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId, isSystemGenerated: true };
}

/** Mirrors `documentService.ts`'s own `getCaseForMerge` exactly — cases
    are read via a client-fetch service (`services/casesService.ts`)
    everywhere else, but a server-side orchestration step mid-request
    needs its own small mock/wix-branching reader, never a `fetch()` call
    to this app's own API from inside a Route Handler. */
async function getCaseForNotification(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<Case | null> {
  if (dataAdapterMode === 'mock') {
    return caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId && !c.isDeleted) ?? null;
  }
  const response = await queryWixDataItems<WixCaseItem>('cases', { filter: { beaconCaseId: caseId, organizationId, isArchived: false }, paging: { limit: 1 } });
  return mapWixCaseItem(response.dataItems[0]?.data);
}

/**
 * Phase 28 (Communications & Notifications). **Additive** to
 * `signatureNotifier.notifyCompleted`/`.notifyDeclined` above — this never
 * replaces the existing external-signer email; it's a *second*,
 * independent notification to the staff member who requested the
 * signature (`SignatureRequest.requestedBy`, captured at request-creation
 * time — never `case_participants`, so this integration has no dependency
 * on that still-unimplemented scope). Routed entirely through
 * `NotificationService`, the sole orchestration layer; this file never
 * resolves a recipient, calls a channel, or writes to a notification
 * collection itself.
 */
async function notifyRequesterOfSignatureOutcome(
  request: SignatureRequest,
  notificationType: 'signature.completed' | 'signature.declined',
  documentFileName: string,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  try {
    const targetCase = await getCaseForNotification(request.organizationId, request.caseId, dataAdapterMode);
    await createNotification(
      {
        notificationType,
        entityType: 'signatureRequest',
        entityId: request.id,
        recipientScope: 'individual',
        recipientIdentityId: request.requestedBy,
        caseId: request.caseId,
        actionUrl: `${getAppBaseUrl()}/cases/${request.caseId}`,
        tokens: { entityTitle: documentFileName, caseNumber: targetCase?.caseNumber ?? '', decedentName: targetCase?.decedentName ?? '' },
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
  } catch (error) {
    console.error(`Failed to send internal ${notificationType} notification:`, error instanceof Error ? error.message : error);
  }
}

/** Used only by `expireOverdueSignatureRequests` (a reconciliation
    function with no real staff/signer actor at all — time simply
    passed) — reconstructs a minimal, request-attributed context from
    the row itself rather than from any live caller, since this function
    has none. */
function signerlessCtx(request: SignatureRequest): ActivityContext {
  return { organizationId: request.organizationId, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: request.correlationId, isSystemGenerated: true };
}

const ACTIVE_STATUSES: readonly SignatureRequestStatus[] = ['draft', 'pending', 'viewed'];

// ---------------------------------------------------------------------------
// Persistence — mirrors services/documentService.ts's persist*/status-flip
// shape exactly.
// ---------------------------------------------------------------------------

async function persistSignatureRequest(request: SignatureRequest, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    signatureRequestFixtures.push(request);
    return;
  }
  await insertWixDataItem<WixSignatureRequestItem>('signatureRequests', buildWixSignatureRequestData(request), request.id);
}

async function persistSignatureRecord(record: SignatureRecord, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    signatureRecordFixtures.push(record);
    return;
  }
  await insertWixDataItem<WixSignatureRecordItem>('signatureRecords', buildWixSignatureRecordData(record), record.id);
}

async function patchSignatureRequest(
  organizationId: string,
  requestId: string,
  patch: Partial<Omit<SignatureRequest, 'id' | 'organizationId'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<SignatureRequest> {
  if (dataAdapterMode === 'mock') {
    const index = signatureRequestFixtures.findIndex((r) => r.id === requestId && r.organizationId === organizationId);
    if (index === -1) throw new SignatureServiceError('Signature request not found.');
    signatureRequestFixtures[index] = { ...signatureRequestFixtures[index], ...patch };
    return signatureRequestFixtures[index];
  }
  const response = await queryWixDataItems<WixSignatureRequestItem>('signatureRequests', {
    filter: { organizationId, beaconSignatureRequestId: requestId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new SignatureServiceError('Signature request not found.');
  const merged = applySignatureRequestPatchToWixData(existingItem.data, patch as Partial<WixSignatureRequestItem>);
  const updated = await updateWixDataItem<WixSignatureRequestItem>('signatureRequests', existingItem.id, merged);
  const mapped = mapWixSignatureRequestItem(updated.data);
  if (!mapped) throw new SignatureServiceError('Failed to update signature request.');
  return mapped;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listRequests(organizationId: string, caseId: string, documentId: string, dataAdapterMode: DataAdapterMode): Promise<SignatureRequest[]> {
  if (dataAdapterMode === 'mock') {
    return signatureRequestFixtures
      .filter((r) => r.organizationId === organizationId && r.caseId === caseId && r.documentId === documentId)
      .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
  }
  const response = await queryWixDataItems<WixSignatureRequestItem>('signatureRequests', { filter: { organizationId, caseId, documentId } });
  return response.dataItems
    .map((item) => mapWixSignatureRequestItem(item.data))
    .filter((r): r is SignatureRequest => r !== null)
    .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
}

/** Phase 32 (Reporting, Analytics & Executive Dashboard). The org-wide
    counterpart to `listRequests()` above — every prior caller only ever
    needed one document's requests. Backs `signatures.pending` and
    `signatures.completion_time_avg_hours`; read-only, same collection,
    no new writer. Exposes `ACTIVE_STATUSES` implicitly by filtering with
    it below rather than exporting the constant, so "what counts as
    active" stays defined in exactly one place. */
export async function listRequestsForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<SignatureRequest[]> {
  if (dataAdapterMode === 'mock') {
    return signatureRequestFixtures.filter((r) => r.organizationId === organizationId);
  }
  const response = await queryWixDataItems<WixSignatureRequestItem>('signatureRequests', { filter: { organizationId } });
  return response.dataItems.map((item) => mapWixSignatureRequestItem(item.data)).filter((r): r is SignatureRequest => r !== null);
}

export function isActiveSignatureRequestStatus(status: SignatureRequestStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export async function listRecords(organizationId: string, caseId: string, documentId: string, dataAdapterMode: DataAdapterMode): Promise<SignatureRecord[]> {
  if (dataAdapterMode === 'mock') {
    return signatureRecordFixtures
      .filter((r) => r.organizationId === organizationId && r.caseId === caseId && r.documentId === documentId)
      .sort((a, b) => (a.signedAt < b.signedAt ? 1 : -1));
  }
  const response = await queryWixDataItems<WixSignatureRecordItem>('signatureRecords', { filter: { organizationId, caseId, documentId } });
  return response.dataItems
    .map((item) => mapWixSignatureRecordItem(item.data))
    .filter((r): r is SignatureRecord => r !== null)
    .sort((a, b) => (a.signedAt < b.signedAt ? 1 : -1));
}

export async function getRequestById(organizationId: string, caseId: string, requestId: string, dataAdapterMode: DataAdapterMode): Promise<SignatureRequest | null> {
  if (dataAdapterMode === 'mock') {
    return signatureRequestFixtures.find((r) => r.id === requestId && r.organizationId === organizationId && r.caseId === caseId) ?? null;
  }
  const response = await queryWixDataItems<WixSignatureRequestItem>('signatureRequests', {
    filter: { organizationId, caseId, beaconSignatureRequestId: requestId },
    paging: { limit: 1 },
  });
  return mapWixSignatureRequestItem(response.dataItems[0]?.data);
}

/** The public signing surface's one and only authorization mechanism:
    hash the raw token, look it up by the collection's unique `tokenHash`
    index, and never distinguish "no such token" from "expired" from
    "wrong token" in the thrown message (existence-hiding, matching
    `forgot-password`'s own discipline). Lazily treats an overdue
    `expiresAt` as expired immediately, regardless of whether
    `expireOverdueSignatureRequests` has reconciled the persisted
    `status` field yet — a security check never trusts a possibly-stale
    status alone. */
export async function resolveSigningToken(rawToken: string, dataAdapterMode: DataAdapterMode): Promise<SignatureRequest> {
  const tokenHash = hashToken(rawToken);

  let request: SignatureRequest | null;
  if (dataAdapterMode === 'mock') {
    request = signatureRequestFixtures.find((r) => r.tokenHash === tokenHash) ?? null;
  } else {
    const response = await queryWixDataItems<WixSignatureRequestItem>('signatureRequests', { filter: { tokenHash }, paging: { limit: 1 } });
    request = mapWixSignatureRequestItem(response.dataItems[0]?.data);
  }

  if (!request) {
    throw new SignatureServiceError('This signing link is invalid or has expired.');
  }
  if (request.expiresAt && new Date(request.expiresAt).getTime() < Date.now() && (request.status === 'pending' || request.status === 'viewed')) {
    throw new SignatureServiceError('This signing link is invalid or has expired.');
  }
  return request;
}

/** Streams the actual document bytes for the signer's in-page review —
    the only path `/api/signing/[token]/document` ever needs, so that
    route (like every other public signing route) delegates entirely to
    this file rather than importing `documentService.ts` itself. Reuses
    `documentService.downloadFile()` directly (re-verifying the checksum
    and never exposing a storage URL, exactly like the authenticated
    download route), attributed to the signer via `signerActivityContext`
    — a genuine `document.downloaded` event is accurate here, since
    reviewing the document before signing really does fetch its bytes. */
export async function getDocumentBytesForSigning(
  request: SignatureRequest,
  dataAdapterMode: DataAdapterMode,
): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  return downloadCaseDocumentFile(request.organizationId, request.caseId, request.documentId, signerActivityContext(request.organizationId, request.correlationId), dataAdapterMode);
}

/** Safe-to-show-pre-signature display context for `GET /api/signing/[token]`
    — reuses `documentService.resolveMergeSourceData()` (already exported
    specifically for cross-reuse, previously only by the template preview
    route) rather than re-implementing Case/Organization lookups here.
    Deliberately returns only display strings, never any internal id
    (`SignatureRequest.id`, `CaseDocument.id`) — the token in the URL is
    the only thing the browser ever needs to hold. */
export async function getSigningPageContext(
  request: SignatureRequest,
  dataAdapterMode: DataAdapterMode,
): Promise<{ documentFileName: string; documentTypeKey: string | null; decedentName: string; organizationName: string }> {
  const [documents, mergeSource] = await Promise.all([
    listCaseDocuments(request.organizationId, request.caseId, dataAdapterMode),
    resolveMergeSourceData(request.organizationId, request.caseId, dataAdapterMode),
  ]);
  const targetDocument = documents.find((d) => d.id === request.documentId);
  return {
    documentFileName: targetDocument?.fileName ?? 'Document',
    documentTypeKey: targetDocument?.documentTypeKey ?? null,
    decedentName: mergeSource.case.decedentName,
    organizationName: mergeSource.organization.name,
  };
}

// ---------------------------------------------------------------------------
// Staff-initiated actions
// ---------------------------------------------------------------------------

export async function createSignatureRequest(
  params: NewSignatureRequestInput & { idFactory: () => string; now?: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<SignatureRequest> {
  const documents = await listCaseDocuments(ctx.organizationId, params.caseId, dataAdapterMode);
  const targetDocument = documents.find((d) => d.id === params.documentId);
  if (!targetDocument) {
    throw new SignatureServiceError('Document not found.');
  }
  if (targetDocument.status !== 'active') {
    throw new SignatureServiceError('Only an active document can be requested for signature.');
  }
  if (targetDocument.signatureStatus === 'signed') {
    throw new SignatureServiceError('This document has already been signed.');
  }

  const existingRequests = await listRequests(ctx.organizationId, params.caseId, params.documentId, dataAdapterMode);
  if (existingRequests.some((r) => ACTIVE_STATUSES.includes(r.status))) {
    throw new SignatureServiceError('An active signature request already exists for this document.');
  }

  const now = params.now ?? nowIso();
  const { token, tokenHash } = generateToken();
  const requestId = params.idFactory();

  const request: SignatureRequest = {
    id: requestId,
    organizationId: ctx.organizationId,
    caseId: params.caseId,
    documentId: params.documentId,
    documentVersion: targetDocument.version ?? 1,
    signerName: params.signerName,
    signerEmail: params.signerEmail,
    signerRole: params.signerRole,
    status: 'draft',
    tokenHash,
    issuedAt: now,
    expiresAt: params.expiresAt ?? defaultExpiresAt(now),
    requestVersion: 1,
    sequenceOrder: 1,
    requestedBy: ctx.actorIdentityId ?? '',
    viewedAt: null,
    signedAt: null,
    declinedAt: null,
    declineReason: null,
    cancelledAt: null,
    cancelledBy: null,
    lastRemindedAt: null,
    reminderCount: 0,
    correlationId: ctx.correlationId,
  };
  await persistSignatureRequest(request, dataAdapterMode);

  try {
    await recordSignatureRequested(ctx, params.caseId, params.documentId, requestId, params.signerName, params.signerEmail, params.signerRole, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.signature.requested activity event:', error instanceof Error ? error.message : error);
  }

  return dispatchAndAdvance(request, token, ctx, dataAdapterMode);
}

/** Shared by `createSignatureRequest` and `resendSignatureRequest` — the
    "attempt the notification, advance draft/current -> pending on
    success, otherwise leave the request's status untouched" two-phase
    step, mirroring `documentService.generate()`'s own
    pending -> active/failed pattern. Never throws back to the caller: a
    delivery failure is a diagnosable, retryable state, not a request
    failure. Takes the raw token directly (never persisted, never
    re-derived from the stored hash — it only ever exists in-process,
    for exactly as long as it takes to build the signing link). */
async function dispatchAndAdvance(request: SignatureRequest, rawToken: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<SignatureRequest> {
  const documents = await listCaseDocuments(request.organizationId, request.caseId, dataAdapterMode);
  const targetDocument = documents.find((d) => d.id === request.documentId);
  const signLink = buildSigningLink(rawToken);

  try {
    await signatureNotifier.notifyRequested({
      to: request.signerEmail,
      signerName: request.signerName,
      caseDisplayName: targetDocument?.fileName ?? 'a document',
      signLink,
      expiresAt: request.expiresAt,
    });
    const updated = await patchSignatureRequest(request.organizationId, request.id, { status: 'pending' }, dataAdapterMode);
    try {
      await recordSignatureEmailSent(ctx, request.caseId, request.documentId, request.id, request.signerEmail, dataAdapterMode);
    } catch (error) {
      console.error('Failed to record document.signature.email.sent activity event:', error instanceof Error ? error.message : error);
    }
    return updated;
  } catch (error) {
    console.error('Signature request notification failed — request remains undelivered:', error instanceof Error ? error.message : error);
    return request;
  }
}

export async function resendSignatureRequest(organizationId: string, caseId: string, requestId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<SignatureRequest> {
  const existing = await getRequestById(organizationId, caseId, requestId, dataAdapterMode);
  if (!existing) {
    throw new SignatureServiceError('Signature request not found.');
  }
  if (!ACTIVE_STATUSES.includes(existing.status)) {
    throw new SignatureServiceError('This signature request can no longer be resent.');
  }

  const { token, tokenHash } = generateToken();
  const now = nowIso();
  const updated = await patchSignatureRequest(
    organizationId,
    requestId,
    { tokenHash, expiresAt: existing.expiresAt ?? defaultExpiresAt(now), lastRemindedAt: now, reminderCount: existing.reminderCount + 1 },
    dataAdapterMode,
  );

  return dispatchAndAdvance(updated, token, ctx, dataAdapterMode);
}

export async function cancelSignatureRequest(organizationId: string, caseId: string, requestId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<void> {
  const existing = await getRequestById(organizationId, caseId, requestId, dataAdapterMode);
  if (!existing) {
    throw new SignatureServiceError('Signature request not found.');
  }
  if (!ACTIVE_STATUSES.includes(existing.status)) {
    throw new SignatureServiceError('This signature request can no longer be cancelled.');
  }

  const now = nowIso();
  await patchSignatureRequest(organizationId, requestId, { status: 'cancelled', cancelledAt: now, cancelledBy: ctx.actorIdentityId }, dataAdapterMode);

  try {
    await recordSignatureCancelled(ctx, caseId, existing.documentId, requestId, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.signature.cancelled activity event:', error instanceof Error ? error.message : error);
  }

  try {
    const documents = await listCaseDocuments(organizationId, caseId, dataAdapterMode);
    const targetDocument = documents.find((d) => d.id === existing.documentId);
    await signatureNotifier.notifyCancelled({ to: existing.signerEmail, signerName: existing.signerName, caseDisplayName: targetDocument?.fileName ?? 'a document' });
  } catch (error) {
    console.error('Failed to send signature.cancelled notification:', error instanceof Error ? error.message : error);
  }
}

/** Reconciliation only — no scheduler exists in this codebase to call
    this automatically (see this phase's own Deferred list). Flips any
    overdue `pending`/`viewed` row to `expired` so list views show
    accurate status without every reader having to recompute it lazily
    (the security-relevant check in `resolveSigningToken` never depends
    on this having run). Scoped to one organization, matching every other
    function in this codebase's tenant-scoping discipline — a future job
    runner iterates organizations itself, rather than this function
    reaching across tenants in one call. */
export async function expireOverdueSignatureRequests(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const now = Date.now();
  let expiredCount = 0;

  for (const status of ['pending', 'viewed'] as const) {
    const candidates =
      dataAdapterMode === 'mock'
        ? signatureRequestFixtures.filter((r) => r.organizationId === organizationId && r.status === status)
        : (await queryWixDataItems<WixSignatureRequestItem>('signatureRequests', { filter: { organizationId, status } })).dataItems
            .map((item) => mapWixSignatureRequestItem(item.data))
            .filter((r): r is SignatureRequest => r !== null);

    for (const candidate of candidates) {
      if (!candidate.expiresAt || new Date(candidate.expiresAt).getTime() >= now) continue;
      await patchSignatureRequest(organizationId, candidate.id, { status: 'expired' }, dataAdapterMode);
      try {
        await recordSignatureExpired(signerlessCtx(candidate), candidate.caseId, candidate.documentId, candidate.id, dataAdapterMode);
      } catch (error) {
        console.error('Failed to record document.signature.expired activity event:', error instanceof Error ? error.message : error);
      }
      expiredCount += 1;
    }
  }

  return expiredCount;
}

// ---------------------------------------------------------------------------
// Signer-initiated actions (no Beacon session ever involved)
// ---------------------------------------------------------------------------

/** First-view-only transition to `'viewed'` — every subsequent access
    still records a `document.signature.viewed` event (every access is
    worth an audit trail entry) without re-transitioning the row. */
export async function markSignatureViewed(request: SignatureRequest, dataAdapterMode: DataAdapterMode): Promise<SignatureRequest> {
  const ctx = signerActivityContext(request.organizationId, request.correlationId);
  try {
    await recordSignatureViewed(ctx, request.caseId, request.documentId, request.id, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.signature.viewed activity event:', error instanceof Error ? error.message : error);
  }

  if (request.status === 'viewed' || request.status === 'signed' || request.status === 'declined' || request.status === 'expired' || request.status === 'cancelled') {
    return request;
  }
  return patchSignatureRequest(request.organizationId, request.id, { status: 'viewed', viewedAt: nowIso() }, dataAdapterMode);
}

/** Phase 29 (Family Portal & External Collaboration). `ctx` is optional
    and defaults to `signerActivityContext(...)` — the exact expression
    this parameter replaces — so the existing `/sign` flow (every current
    call site) is entirely unaffected. `services/portal/portalDocumentService.ts`-
    adjacent family-side signature completion (a future call site) passes
    `portalActivityContext(...)` instead, so a family member's completion
    is attributed the same anonymous-actor way but carries `PortalUser`
    metadata via its own `recordPortalSignatureCompleted` call, never by
    changing this function's own signature-completion logic. */
export async function completeSignatureRequest(
  request: SignatureRequest,
  params: { signedName: string; initials?: string; ipAddress: string; userAgent: string; idFactory: () => string; now?: string },
  dataAdapterMode: DataAdapterMode,
  ctx: ActivityContext = signerActivityContext(request.organizationId, request.correlationId),
): Promise<{ request: SignatureRequest; record: SignatureRecord }> {
  if (request.status !== 'pending' && request.status !== 'viewed') {
    throw new SignatureServiceError('This signature request can no longer be completed.');
  }

  const documents = await listCaseDocuments(request.organizationId, request.caseId, dataAdapterMode);
  const targetDocument = documents.find((d) => d.id === request.documentId);
  if (!targetDocument) {
    throw new SignatureServiceError('Document not found.');
  }

  const { buffer } = await downloadCaseDocumentFile(request.organizationId, request.caseId, request.documentId, ctx, dataAdapterMode);
  const actualChecksum = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actualChecksum !== targetDocument.checksumSha256) {
    console.error(`Document integrity check failed while signing document ${request.documentId} (organization ${request.organizationId}) — refusing to complete the signature.`);
    throw new SignatureServiceError('Document integrity check failed — this document cannot be signed right now. Please contact the funeral home.');
  }

  const now = params.now ?? nowIso();
  const record: SignatureRecord = {
    id: params.idFactory(),
    organizationId: request.organizationId,
    caseId: request.caseId,
    documentId: request.documentId,
    documentVersion: request.documentVersion,
    signatureRequestId: request.id,
    signerName: request.signerName,
    signerEmail: request.signerEmail,
    signerRole: request.signerRole,
    signedName: params.signedName,
    initials: params.initials ?? null,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    signatureMethod: 'typed_name',
    verificationStatus: 'verified',
    documentChecksumSha256: actualChecksum,
    recordVersion: 1,
    correlationId: request.correlationId,
    signedAt: now,
  };
  await persistSignatureRecord(record, dataAdapterMode);

  const updatedRequest = await patchSignatureRequest(request.organizationId, request.id, { status: 'signed', signedAt: now }, dataAdapterMode);
  await markDocumentSigned(request.organizationId, request.caseId, request.documentId, dataAdapterMode);

  try {
    await recordSignatureCompleted(ctx, request.caseId, request.documentId, request.id, request.signerName, params.ipAddress, params.userAgent, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.signature.completed activity event:', error instanceof Error ? error.message : error);
  }

  try {
    await signatureNotifier.notifyCompleted({ to: request.signerEmail, signerName: request.signerName, caseDisplayName: targetDocument.fileName });
  } catch (error) {
    console.error('Failed to send signature.completed notification:', error instanceof Error ? error.message : error);
  }
  await notifyRequesterOfSignatureOutcome(request, 'signature.completed', targetDocument.fileName, ctx, dataAdapterMode);

  return { request: updatedRequest, record };
}

/** Phase 29: `ctx` is optional and defaults to `signerActivityContext(...)`
    — see `completeSignatureRequest`'s own comment on why this is a purely
    additive, backward-compatible change. */
export async function declineSignatureRequest(
  request: SignatureRequest,
  params: { reason?: string; ipAddress: string; userAgent: string },
  dataAdapterMode: DataAdapterMode,
  ctx: ActivityContext = signerActivityContext(request.organizationId, request.correlationId),
): Promise<SignatureRequest> {
  if (request.status !== 'pending' && request.status !== 'viewed') {
    throw new SignatureServiceError('This signature request can no longer be declined.');
  }

  const now = nowIso();
  const updated = await patchSignatureRequest(request.organizationId, request.id, { status: 'declined', declinedAt: now, declineReason: params.reason ?? null }, dataAdapterMode);

  try {
    await recordSignatureDeclined(ctx, request.caseId, request.documentId, request.id, request.signerName, params.reason ?? null, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.signature.declined activity event:', error instanceof Error ? error.message : error);
  }

  const documents = await listCaseDocuments(request.organizationId, request.caseId, dataAdapterMode);
  const targetDocument = documents.find((d) => d.id === request.documentId);
  try {
    await signatureNotifier.notifyDeclined({ to: request.signerEmail, signerName: request.signerName, caseDisplayName: targetDocument?.fileName ?? 'a document', reason: params.reason ?? null });
  } catch (error) {
    console.error('Failed to send signature.declined notification:', error instanceof Error ? error.message : error);
  }
  await notifyRequesterOfSignatureOutcome(request, 'signature.declined', targetDocument?.fileName ?? 'a document', ctx, dataAdapterMode);

  return updated;
}
