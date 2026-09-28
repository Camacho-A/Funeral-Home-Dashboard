import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageRoles } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { list as listCaseDocuments } from '@/services/documentService';
import { deleteWixDataItem, WixDataApiError } from '@/lib/wixDataApi';
import type { CaseDocument } from '@/types/caseDocument';

/**
 * B2026-034 failed-Statement-document cleanup (2026-09) — a TEMPORARY,
 * ADMIN-ONLY, ONE-CASE endpoint, mirroring
 * `app/api/admin/incident-recovery/b2026-034/route.ts`'s own shape
 * (hard-scoped constants, GET-then-POST re-verification, sanitized
 * response, Administrator-only, Manors-only, `DATA_ADAPTER=wix`-only).
 *
 * BACKGROUND: while the Production Chromium/Statement rendering bug was
 * being debugged, several `generate()`/`generateBillingDocument()` calls
 * against this case failed partway through, each leaving behind its own
 * `CaseDocument` row with `status: 'failed'` (see
 * `services/documentService.ts`'s `catch` blocks — every failure path
 * persists `status: 'failed', storageKey: '', checksumSha256: '',
 * fileSizeBytes: 0`, so a failed row can never reference real stored
 * bytes). Statement generation now works; these rows are pure clutter in
 * the Documents tab and are being removed.
 *
 * SCOPE GUARANTEES:
 *   - Hard-scoped to exactly one Case (`TARGET_CASE_ID`/`TARGET_CASE_NUMBER`)
 *     and one Organization (`MANORS_ORGANIZATION_ID`) — no caseId or
 *     organizationId is ever accepted from the request body for anything
 *     other than the standard authorization check every route performs.
 *   - Deletes ONLY a `CaseDocument` row that passes every check in
 *     `checkEligibility` below, re-verified from scratch on every POST
 *     (never trusting an earlier GET).
 *   - Never deletes a Blob/storage object — this route never imports or
 *     calls `documentStorageProvider`/`vercelBlobStorageProvider` at all.
 *     A candidate whose `storageKey` is unexpectedly non-empty is refused
 *     and reported, never deleted.
 *   - Never deletes `Arrangement Forms.pdf`, regardless of its status —
 *     an explicit, filename-based guard independent of the status check.
 *   - Never deletes a row that another row's `supersedesId` still points
 *     to (would only ever happen if something were regenerated from a
 *     failed attempt, which no code path in this app does — checked
 *     defensively anyway).
 *   - No PII, storageKey, checksum, or document content is ever included
 *     in a response — only id/type/status/version/timestamp metadata and
 *     a boolean for "has a storage key."
 *   - Existing `ActivityEvent` audit history is never touched — this
 *     route only ever calls `deleteWixDataItem('caseDocuments', ...)`,
 *     never anything in `activityService.ts`.
 */

const MANORS_ORGANIZATION_ID = 'managed-cremations';
/** Same Case `_id`/`beaconCaseId` the incident-recovery route targeted —
    Wix inserts a `cases` row with `_id` set to its own `beaconCaseId`
    (see `lib/wixDataApi.ts`'s `insertWixDataItem` comment), and
    `CaseDocument.caseId` is that same value. */
const TARGET_CASE_ID = '9d058cf4-9149-40ab-8c1c-4257a6c9b1f2';
const TARGET_CASE_NUMBER = 'B2026-034';
/** Never eligible for deletion, by filename, regardless of status — the
    recovered Arrangement Forms document for this case is complete and
    must never be touched by this or any other cleanup. */
const PROTECTED_FILE_NAME = 'Arrangement Forms.pdf';

type SanitizedDocument = {
  id: string;
  documentTypeKey: string | null;
  category: string | null;
  fileName: string;
  status: string;
  version: number | null;
  createdAt: string;
  hasStorageKey: boolean;
  supersedesId: string | null;
};

function sanitize(doc: CaseDocument): SanitizedDocument {
  return {
    id: doc.id,
    documentTypeKey: doc.documentTypeKey,
    category: doc.category,
    fileName: doc.fileName,
    status: doc.status,
    version: doc.version,
    createdAt: doc.createdAt,
    hasStorageKey: doc.storageKey.length > 0,
    supersedesId: doc.supersedesId,
  };
}

type EligibilityResult = { eligible: boolean; reason: string | null };

/** Every one of the 9 deletion-eligibility criteria, checked explicitly —
    never inferred from a UI label, always from the underlying record. */
function checkEligibility(candidate: CaseDocument, allDocuments: CaseDocument[]): EligibilityResult {
  if (candidate.caseId !== TARGET_CASE_ID) {
    return { eligible: false, reason: 'Does not belong to the target case.' };
  }
  if (candidate.status !== 'failed') {
    return { eligible: false, reason: `Status is "${candidate.status}", not "failed" — never a cleanup candidate.` };
  }
  if (candidate.fileName === PROTECTED_FILE_NAME) {
    return { eligible: false, reason: 'Protected — Arrangement Forms.pdf is never eligible regardless of status.' };
  }
  if (candidate.storageKey.length > 0) {
    return { eligible: false, reason: 'Has a non-empty storageKey — a failed record is expected to have none; refusing to delete without further investigation.' };
  }
  const referencedByAnother = allDocuments.some((d) => d.id !== candidate.id && d.supersedesId === candidate.id);
  if (referencedByAnother) {
    return { eligible: false, reason: 'Another document row references this one via supersedesId — deleting would damage document lineage.' };
  }
  return { eligible: true, reason: null };
}

async function authorizeRequest(requestedOrganizationId: string) {
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) {
    return { ok: false as const, response: authResult.response };
  }
  const { organizationId, userId, role } = authResult.context;
  const mode = getDataAdapterMode();

  const isAdministrator = await canManageRoles({ identityId: userId, organizationId, roleKey: role }, mode);
  if (!isAdministrator) {
    return { ok: false as const, response: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }) };
  }
  if (organizationId !== MANORS_ORGANIZATION_ID) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'This action is only available for the Manors organization.' }, { status: 400 }),
    };
  }
  if (mode !== 'wix') {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'This action only applies when DATA_ADAPTER=wix.' }, { status: 400 }),
    };
  }

  return { ok: true as const, organizationId, mode };
}

/** GET — read-only eligibility listing. Never mutates. Mirrors
    `app/api/admin/incident-recovery/b2026-034/route.ts`'s own GET/POST
    split. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const auth = await authorizeRequest(organizationId);
  if (!auth.ok) return auth.response;

  const documents = await listCaseDocuments(auth.organizationId, TARGET_CASE_ID, auth.mode);
  const rows = documents.map((doc) => ({ ...sanitize(doc), ...checkEligibility(doc, documents) }));

  return NextResponse.json({
    caseNumber: TARGET_CASE_NUMBER,
    totalDocuments: documents.length,
    eligibleForCleanupCount: rows.filter((r) => r.eligible).length,
    documents: rows,
  });
}

/** POST — deletes ONLY `CaseDocument` rows that pass every eligibility
    check, re-verified from scratch here (never trusting an earlier GET,
    which could be stale by the time an operator confirms). Never touches
    Blob/file storage or `ActivityEvent` history. */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const auth = await authorizeRequest(b.organizationId);
  if (!auth.ok) return auth.response;

  // Fresh read — never relies on an earlier GET.
  const documents = await listCaseDocuments(auth.organizationId, TARGET_CASE_ID, auth.mode);
  const evaluated = documents.map((doc) => ({ doc, ...checkEligibility(doc, documents) }));
  const eligible = evaluated.filter((e) => e.eligible);
  const skippedFailedRecords = evaluated.filter((e) => !e.eligible && e.doc.status === 'failed');

  const deletedIds: string[] = [];
  const failedDeletions: Array<{ id: string; error: string }> = [];
  for (const { doc } of eligible) {
    try {
      await deleteWixDataItem('caseDocuments', doc.id);
      deletedIds.push(doc.id);
    } catch (error) {
      const message = error instanceof WixDataApiError ? error.message : 'Unknown error connecting to Wix.';
      failedDeletions.push({ id: doc.id, error: message });
    }
  }

  return NextResponse.json({
    caseNumber: TARGET_CASE_NUMBER,
    deletedCount: deletedIds.length,
    deletedIds,
    failedDeletions,
    skippedFailedRecords: skippedFailedRecords.map((s) => ({ id: s.doc.id, reason: s.reason })),
  });
}
