import crypto from 'crypto';
import type { DataAdapterMode } from '@/lib/env';
import type { Case } from '@/types/case';
import type { CaseDocument } from '@/types/caseDocument';
import type { ActivityContext } from '../activityService';
import { recordFaxBundleEvent } from '../activityService';
import { ACTIVITY_EVENT_TYPES } from '@/types/activityEvent';
import { DOCUMENT_TYPES } from '@/domain/documents/documentTypeRegistry';
import { queryAllWixDataItems } from '@/lib/wixDataApi';
import { mapWixCaseDocumentItem, type WixCaseDocumentItem } from '@/lib/wixCaseDocumentMapper';
import { caseDocumentFixtures } from '../__mocks__/documentFixtures';
import { deleteOrganizationFile, readOrganizationFile, readStoredCaseDocument, storeOrganizationFile } from '../documentService';
import { loadCaseOnServer } from '../serverCaseLoader';
import { getCrematoryMailboxAccess, getCrematoryMailboxStatus, CrematoryMailboxError } from '../crematory/crematoryMailboxService';
import { sendOutlookMessage, OutlookMailError } from '@/lib/microsoft/outlookMail';
import { getAppointment } from '../scheduling/appointmentReads';
import { expectedPickupAppointmentId } from '../cremainsPickupService';
import { expectedDateOf } from '@/domain/scheduling/cremainsPickupPresentation';
import { completeChecklistItemsAutomatically } from '../automaticChecklistCompletion';
import { canConfirmFax } from '../authorizationPolicyService';
import { reconcileCaseWorkflow } from '../workflowReconciliationService';
import { checklistItemKey } from '@/domain/workflow/checklistItemKey';
import { toDisplayCasingIfAllCaps } from '@/utils/string';
import {
  FAX_BUNDLE_PURPOSE,
  FAX_BUNDLE_STATE_LABEL,
  canRecordOutcome,
  dayBefore,
  faxBundleState,
  isAbandonedSendHold,
  newFaxBundleReference,
  type FaxBundle,
  type FaxBundleItem,
  type FaxBundleState,
} from '@/domain/faxBundles/faxBundle';
import {
  MAX_APPLICATIONS_PER_BUNDLE,
  deathCertificateFaxSettings,
  faxAttachmentLimit,
  formatFaxNumber,
  formatMegabytes,
  type DeathCertificateFaxSettings,
} from '@/domain/faxBundles/faxSettings';
import { FaxSettingsServiceError, listSendableFaxDestinations, renderBundleEmail, resolveFaxConfiguration, type EffectiveFaxConfiguration, type SendableFaxDestination } from '../faxSettings/faxSettingsService';
import { DC_APPLICATION_FAX_DELIVERED_EVENT, dcApplicationSentItem } from '@/domain/faxBundles/faxChecklist';
import { FaxBundleError } from './faxBundleError';
import { RequestBoxError, buildFaxBundlePdf, inspectApplication } from './faxBundlePdf';
import {
  claimCaseForFaxBundle,
  findFaxBundleByReference,
  getFaxBundle,
  getFaxCaseClaim,
  insertFaxBundle,
  linkCaseToFaxBundle,
  listFaxBundleIdsForCase,
  listFaxBundlesByStatus,
  listFaxCaseClaims,
  newFaxBundleId,
  releaseFaxCaseClaim,
  updateFaxBundleIf,
} from './faxBundleStore';

/**
 * Manatee County DC application fax bundles (2026-11).
 *
 *   Select 1 or more cases → Preview one bundle → Send one fax.
 *
 * PREVIEW builds ONE PDF from each selected case's latest saved application
 * (never unsaved edits, never regenerated), numbered "n of N" in the form's
 * own Request boxes, stores it privately ONCE with its checksum, and records
 * the bundle as ready. What staff preview is that stored file.
 *
 * SEND FAX transmits exactly that stored file — re-checked against its
 * checksum and against each application still being the one previewed — as
 * ONE email with ONE attachment from the connected mailbox to NuSo's
 * email-to-fax gateway. Safeguards, all on the server:
 *   - sending stays off for an organization until it is verified;
 *   - the bundle moves ready → sending only once (revision-conditioned): a
 *     double click, refresh or retried request cannot send twice;
 *   - each case is then held by a claim row with a fixed id — a case can be
 *     in only one bundle that is being sent, submitted or delivered;
 *   - before Outlook is contacted the attempt is recorded
 *     (outlookContactedAt); if it cannot be, nothing is sent;
 *   - an Outlook failure that cannot have sent returns the bundle to ready
 *     (cases released; staff may press Send Fax again); any failure that
 *     MAY have sent — and an outcome that could not be recorded — leaves the
 *     bundle needing review. Nothing is ever retried automatically;
 *   - "submitted" means Outlook accepted the email for NuSo. Only an
 *     member with fax.confirm records delivered (or failed); delivered
 *     completes "Sent day before ashes arrive" and keeps every case held, so
 *     a delivered application is never sent again.
 */

const MANATEE_TYPE = DOCUMENT_TYPES.VITAL_RECORDS_MANATEE_DEATH_CERTIFICATE_APPLICATION.key;
const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');
const displayName = (case_: Pick<Case, 'decedentName'>) => toDisplayCasingIfAllCaps((case_.decedentName ?? '').trim()) || 'Unnamed decedent';

function requireSettings(organizationId: string): DeathCertificateFaxSettings {
  const settings = deathCertificateFaxSettings(organizationId);
  if (!settings) throw new FaxBundleError('Faxing DC applications is not set up for this organization.', 404);
  return settings;
}

/**
 * The organization's fax configuration right now (Fax Settings, 2026-11):
 * destination, provider, subject and message. With nothing saved it is the
 * organization profile's built-in values, exactly as before Fax Settings.
 */
async function configurationOf(organizationId: string, mode: DataAdapterMode, destinationId?: string | null): Promise<EffectiveFaxConfiguration> {
  try {
    return await resolveFaxConfiguration(organizationId, mode, destinationId);
  } catch (error) {
    if (error instanceof FaxSettingsServiceError) throw new FaxBundleError(`${error.message} Nothing was sent.`, error.status === 404 ? 404 : error.status === 409 ? 409 : 503);
    throw error;
  }
}

async function audit(ctx: ActivityContext, caseId: string | null, eventType: Parameters<typeof recordFaxBundleEvent>[2], details: Parameters<typeof recordFaxBundleEvent>[3], mode: DataAdapterMode) {
  try {
    await recordFaxBundleEvent(ctx, caseId, eventType, details, mode);
  } catch (error) {
    console.error(`Failed to record ${eventType}:`, error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------- applications

/** Every active, SOLIS-saved Manatee application in the organization, latest per case. */
async function latestApplicationsByCase(organizationId: string, mode: DataAdapterMode): Promise<Map<string, CaseDocument>> {
  const documents =
    mode === 'mock'
      ? caseDocumentFixtures.filter((d) => d.organizationId === organizationId && d.documentTypeKey === MANATEE_TYPE)
      : (await queryAllWixDataItems<WixCaseDocumentItem>('caseDocuments', { organizationId, documentTypeKey: MANATEE_TYPE }))
          .map((item) => mapWixCaseDocumentItem(item.data))
          .filter((d): d is CaseDocument => d !== null);
  const latest = new Map<string, CaseDocument>();
  for (const d of documents) {
    if (d.status !== 'active' || d.origin !== 'generated' || d.organizationId !== organizationId) continue;
    const current = latest.get(d.caseId);
    if (!current || (d.version ?? 0) > (current.version ?? 0) || ((d.version ?? 0) === (current.version ?? 0) && d.createdAt > current.createdAt)) latest.set(d.caseId, d);
  }
  return latest;
}


async function expectedPickupDate(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<string | null> {
  const appointment = await getAppointment(organizationId, expectedPickupAppointmentId(caseId), mode).catch(() => null);
  if (!appointment || appointment.status === 'cancelled') return null;
  return expectedDateOf(appointment);
}

// ---------------------------------------------------------------- views

export type FaxBundleView = {
  id: string;
  reference: string;
  state: FaxBundleState;
  stateLabel: string;
  applicationCount: number;
  pageCount: number;
  sizeBytes: number;
  /** The destination it was prepared for (null = the built-in destination). */
  destinationId: string | null;
  destinationName: string;
  destinationFax: string;
  destinationAddress: string;
  subject: string;
  senderAddress: string | null;
  createdAt: string;
  submittedAt: string | null;
  deliveredAt: string | null;
  confirmedAt: string | null;
  nusoReference: string | null;
  failureMessage: string | null;
  sendingEnabled: boolean;
  items: Array<{ position: number; caseId: string; caseNumber: string; decedentDisplayName: string; documentVersion: number | null; numbering: FaxBundleItem['numbering']; pageCount: number }>;
};

async function viewOf(bundle: FaxBundle, mode: DataAdapterMode): Promise<FaxBundleView> {
  const settings = deathCertificateFaxSettings(bundle.organizationId);
  const names = await Promise.all(bundle.items.map(async (item) => (await loadCaseOnServer(bundle.organizationId, item.caseId, mode).catch(() => null)) ?? null));
  let sender = bundle.senderAddress;
  if (!sender && bundle.status === 'ready') {
    const mailbox = await getCrematoryMailboxStatus(bundle.organizationId, mode).catch(() => null);
    sender = mailbox?.connected ? mailbox.accountEmail : null;
  }
  const state = faxBundleState(bundle);
  return {
    id: bundle.id,
    reference: bundle.reference,
    state,
    stateLabel: FAX_BUNDLE_STATE_LABEL[state],
    applicationCount: bundle.applicationCount,
    pageCount: bundle.pdfPageCount,
    sizeBytes: bundle.pdfSizeBytes,
    destinationId: bundle.destinationId,
    destinationName: bundle.destinationName,
    destinationFax: formatFaxNumber(bundle.destinationFaxNumber),
    destinationAddress: bundle.destinationAddress,
    subject: bundle.subject,
    senderAddress: sender,
    createdAt: bundle.createdAt,
    submittedAt: bundle.submittedAt,
    deliveredAt: bundle.deliveredAt,
    confirmedAt: bundle.confirmedAt,
    nusoReference: bundle.nusoReference,
    failureMessage: bundle.failureMessage,
    sendingEnabled: settings?.sendingEnabled === true,
    items: bundle.items.map((item, i) => ({
      position: item.position,
      caseId: item.caseId,
      caseNumber: item.caseNumber,
      decedentDisplayName: names[i] ? displayName(names[i]!) : 'Case unavailable',
      documentVersion: item.documentVersion,
      numbering: item.numbering,
      pageCount: item.pageCount,
    })),
  };
}

export async function getFaxBundleView(organizationId: string, bundleId: string, mode: DataAdapterMode): Promise<FaxBundleView> {
  requireSettings(organizationId);
  const bundle = await getFaxBundle(organizationId, bundleId, mode);
  if (!bundle) throw new FaxBundleError('Fax bundle not found.', 404);
  return viewOf(bundle, mode);
}

/** The exact stored bundle PDF, verified against its checksum. */
export async function getFaxBundlePdf(organizationId: string, bundleId: string, mode: DataAdapterMode): Promise<{ bytes: Uint8Array; fileName: string }> {
  requireSettings(organizationId);
  const bundle = await getFaxBundle(organizationId, bundleId, mode);
  if (!bundle || bundle.status === 'discarded') throw new FaxBundleError('Fax bundle not found.', 404);
  const bytes = await readBundlePdf(bundle);
  return { bytes, fileName: `${bundle.reference}.pdf` };
}

async function readBundlePdf(bundle: FaxBundle): Promise<Uint8Array> {
  const bytes = await readOrganizationFile(bundle.organizationId, bundle.pdfStorageKey).catch(() => null);
  if (!bytes || sha256(bytes) !== bundle.pdfChecksumSha256) throw new FaxBundleError('The bundle PDF could not be read intact from document storage. Preview the bundle again.', 503);
  return bytes;
}

// ---------------------------------------------------------------- eligibility

export type FaxEligibleCase = {
  caseId: string;
  caseNumber: string;
  decedentDisplayName: string;
  documentId: string;
  documentVersion: number | null;
  savedAt: string;
  expectedPickupDate: string | null;
  /** The day before the Expected Pickup — guidance only, never a block. */
  targetDate: string | null;
  available: boolean;
  reason: string | null;
};

/** The bundle holding this case, if it is still holding it. */
async function holdingBundle(organizationId: string, bundleId: string, mode: DataAdapterMode, cache = new Map<string, FaxBundle | null>()): Promise<FaxBundle | null> {
  if (!cache.has(bundleId)) cache.set(bundleId, await getFaxBundle(organizationId, bundleId, mode));
  const bundle = cache.get(bundleId) ?? null;
  if (!bundle || bundle.status === 'failed' || bundle.status === 'discarded' || bundle.status === 'ready' || isAbandonedSendHold(bundle)) return null;
  return bundle;
}

function heldReason(bundle: FaxBundle): string {
  const state = faxBundleState(bundle);
  if (state === 'delivered') return `Already faxed and delivered (${bundle.reference}).`;
  if (state === 'submitted') return `Faxed in ${bundle.reference} — waiting for delivery confirmation.`;
  if (state === 'needs_review') return `${bundle.reference} may have been faxed — someone allowed to record fax results must record what happened.`;
  return `Being faxed right now (${bundle.reference}).`;
}

/**
 * Cases whose latest saved application could go in a bundle: not archived,
 * not delivered by fax, and not already marked "Sent day before ashes
 * arrive" (sent outside SOLIS). Each says why if it cannot be selected.
 */
export async function listFaxEligibleCases(
  organizationId: string,
  mode: DataAdapterMode,
): Promise<{ cases: FaxEligibleCase[]; destinationName: string; destinationFax: string; destinations: SendableFaxDestination[]; sendingEnabled: boolean; maxApplications: number }> {
  const settings = requireSettings(organizationId);
  const [applications, claims] = await Promise.all([latestApplicationsByCase(organizationId, mode), listFaxCaseClaims(organizationId, mode)]);
  const claimOf = new Map(claims.map((c) => [c.caseId, c.bundleId]));
  const bundles = new Map<string, FaxBundle | null>();
  const cases: FaxEligibleCase[] = [];
  for (const [caseId, document] of applications) {
    const claim = claimOf.get(caseId);
    const holder = claim ? await holdingBundle(organizationId, claim, mode, bundles) : null;
    if (holder?.status === 'delivered') continue;
    const case_ = await loadCaseOnServer(organizationId, caseId, mode).catch(() => null);
    if (!case_ || case_.isDeleted) continue;
    if (!holder && case_.checklistState?.[checklistItemKey(4, 1)] === true && dcApplicationSentItem(case_).length > 0) continue;
    const pickup = await expectedPickupDate(organizationId, caseId, mode);
    cases.push({
      caseId,
      caseNumber: case_.caseNumber,
      decedentDisplayName: displayName(case_),
      documentId: document.id,
      documentVersion: document.version,
      savedAt: document.createdAt,
      expectedPickupDate: pickup,
      targetDate: pickup ? dayBefore(pickup) : null,
      available: !holder,
      reason: holder ? heldReason(holder) : null,
    });
  }
  cases.sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') || a.caseNumber.localeCompare(b.caseNumber));
  const config = await configurationOf(organizationId, mode);
  // The organization's own active destinations (name and number), default first — staff may pick one per bundle.
  const destinations = await listSendableFaxDestinations(organizationId, mode).catch(() => []);
  return { cases, destinationName: config.destination.name, destinationFax: formatFaxNumber(config.destination.faxNumber), destinations, sendingEnabled: settings.sendingEnabled, maxApplications: MAX_APPLICATIONS_PER_BUNDLE };
}

// ---------------------------------------------------------------- preview

function validCaseIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id)) throw new FaxBundleError('Select at least one case.', 400);
  const ids = value as string[];
  if (ids.length === 0) throw new FaxBundleError('Select at least one case.', 400);
  if (new Set(ids).size !== ids.length) throw new FaxBundleError('A case was selected twice. Each application can be in a bundle once.', 400);
  if (ids.length > MAX_APPLICATIONS_PER_BUNDLE) throw new FaxBundleError(`A bundle can hold at most ${MAX_APPLICATIONS_PER_BUNDLE} applications.`, 400);
  return ids;
}

/** Unsent previews older than a day are discarded and their PDFs deleted. Best-effort. */
async function discardExpiredPreviews(ctx: ActivityContext, mode: DataAdapterMode): Promise<void> {
  try {
    const ready = await listFaxBundlesByStatus(ctx.organizationId, ['ready'], mode);
    for (const bundle of ready.filter((b) => faxBundleState(b) === 'expired').slice(0, 10)) await discard(ctx, bundle, 'preview_expired', mode);
  } catch (error) {
    console.error('Failed to discard expired fax bundle previews:', error instanceof Error ? error.message : error);
  }
}

async function discard(ctx: ActivityContext, bundle: FaxBundle, action: string, mode: DataAdapterMode): Promise<void> {
  const done = await updateFaxBundleIf(bundle, { status: 'discarded' }, { actorId: ctx.actorIdentityId, action, note: null }, mode);
  if (done) await deleteOrganizationFile(bundle.organizationId, bundle.pdfStorageKey).catch(() => undefined);
}

async function uniqueReference(organizationId: string, mode: DataAdapterMode): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = newFaxBundleReference((n) => crypto.randomBytes(n));
    if (!(await findFaxBundleByReference(organizationId, reference, mode))) return reference;
  }
  throw new FaxBundleError('A bundle reference could not be created. Please try again.', 503);
}

/**
 * Builds and stores the bundle for exactly these cases, in this order.
 * Refused — nothing stored — with each case's reason if any case cannot be
 * included.
 */
export async function previewFaxBundle(ctx: ActivityContext, requestedCaseIds: unknown, mode: DataAdapterMode, requestedDestinationId?: unknown): Promise<FaxBundleView> {
  const settings = requireSettings(ctx.organizationId);
  // One of this organization's active destinations, or (omitted) its default. Checked on the server; never trusted from the browser.
  if (requestedDestinationId !== undefined && requestedDestinationId !== null && (typeof requestedDestinationId !== 'string' || !requestedDestinationId || requestedDestinationId.length > 64)) {
    throw new FaxBundleError('Choose a fax destination from the list.', 400);
  }
  const config = await configurationOf(ctx.organizationId, mode, requestedDestinationId as string | null | undefined);
  const caseIds = validCaseIds(requestedCaseIds);
  await discardExpiredPreviews(ctx, mode);

  const applications = await latestApplicationsByCase(ctx.organizationId, mode);
  const problems: Array<{ caseId: string; reason: string }> = [];
  const loaded: Array<{ case_: Case; document: CaseDocument; bytes: Uint8Array }> = [];
  for (const caseId of caseIds) {
    const case_ = await loadCaseOnServer(ctx.organizationId, caseId, mode).catch(() => null);
    if (!case_) {
      problems.push({ caseId, reason: 'Case not found.' });
      continue;
    }
    if (case_.isDeleted) {
      problems.push({ caseId, reason: 'This case is archived.' });
      continue;
    }
    const claim = await getFaxCaseClaim(ctx.organizationId, caseId, mode);
    const holder = claim ? await holdingBundle(ctx.organizationId, claim.bundleId, mode) : null;
    if (holder) {
      problems.push({ caseId, reason: heldReason(holder) });
      continue;
    }
    const document = applications.get(caseId);
    if (!document) {
      problems.push({ caseId, reason: 'No saved Manatee County application. Create and save it first.' });
      continue;
    }
    const stored = await readStoredCaseDocument(ctx.organizationId, caseId, document.id, mode).catch(() => null);
    const bytes = stored ? new Uint8Array(stored.buffer) : null;
    if (!bytes || sha256(bytes) !== document.checksumSha256) {
      problems.push({ caseId, reason: 'The saved application could not be read intact from document storage.' });
      continue;
    }
    try {
      await inspectApplication(bytes);
    } catch (error) {
      if (!(error instanceof RequestBoxError)) throw error;
      problems.push({ caseId, reason: `${error.message} Save the application again from Create document.` });
      continue;
    }
    loaded.push({ case_, document, bytes });
  }
  if (problems.length > 0) {
    throw new FaxBundleError(problems.length === 1 ? 'One selected case cannot be included.' : `${problems.length} selected cases cannot be included.`, 422, problems);
  }

  let built: Awaited<ReturnType<typeof buildFaxBundlePdf>>;
  try {
    built = await buildFaxBundlePdf(loaded.map((l) => ({ bytes: l.bytes })));
  } catch (error) {
    console.error('Failed to build a fax bundle PDF:', error instanceof Error ? error.message : error);
    throw new FaxBundleError('The bundle PDF could not be created. Nothing was saved.', 500);
  }
  const limit = faxAttachmentLimit(settings);
  if (built.bytes.byteLength > limit) {
    throw new FaxBundleError(`This bundle is ${formatMegabytes(built.bytes.byteLength)}; the limit is ${formatMegabytes(limit)}. Remove some applications and fax them in another bundle.`, 413);
  }

  const id = newFaxBundleId();
  const reference = await uniqueReference(ctx.organizationId, mode);
  const email = renderBundleEmail(config, { reference, applicationCount: loaded.length, pageCount: built.pageCount });
  const now = new Date().toISOString();
  const items: FaxBundleItem[] = loaded.map((l, i) => ({
    position: i + 1,
    caseId: l.case_.id,
    caseNumber: l.case_.caseNumber,
    documentId: l.document.id,
    documentVersion: l.document.version,
    documentChecksumSha256: l.document.checksumSha256,
    pageCount: built.applications[i].pageCount,
    numbering: built.applications[i].numbering,
  }));
  const bundle: FaxBundle = {
    id,
    organizationId: ctx.organizationId,
    reference,
    purpose: FAX_BUNDLE_PURPOSE,
    status: 'ready',
    revision: 0,
    items,
    caseIds: items.map((i) => i.caseId),
    applicationCount: items.length,
    pdfStorageKey: `${ctx.organizationId}/fax-bundles/${id}.pdf`,
    pdfChecksumSha256: sha256(built.bytes),
    pdfSizeBytes: built.bytes.byteLength,
    pdfPageCount: built.pageCount,
    // The snapshot Send Fax uses — never the settings as they are later.
    destinationName: config.destination.name,
    destinationFaxNumber: config.destination.faxNumber,
    destinationAddress: config.destination.address,
    gatewayDomain: config.provider.gatewayDomain,
    subject: email.subject,
    destinationId: config.destination.id,
    providerKey: config.provider.key,
    emailBody: email.body,
    settingsRevision: config.settingsRevision,
    senderAddress: null,
    createdBy: ctx.actorIdentityId,
    createdAt: now,
    updatedAt: now,
    submissionId: null,
    sentBy: null,
    outlookContactedAt: null,
    submittedAt: null,
    outlookDraftId: null,
    internetMessageId: null,
    failureCode: null,
    failureMessage: null,
    confirmedBy: null,
    confirmedAt: null,
    deliveredAt: null,
    nusoReference: null,
    confirmationDocumentId: null,
    history: [{ at: now, actorId: ctx.actorIdentityId, action: 'previewed', fromStatus: null, toStatus: 'ready', note: null }],
  };

  const { storageKey } = await storeOrganizationFile(ctx.organizationId, bundle.pdfStorageKey, built.bytes, 'application/pdf');
  bundle.pdfStorageKey = storageKey;
  try {
    if ((await insertFaxBundle(bundle, mode)) !== 'inserted') throw new Error('bundle id already exists');
  } catch (error) {
    console.error('Failed to record a fax bundle:', error instanceof Error ? error.message : error);
    await deleteOrganizationFile(ctx.organizationId, storageKey).catch(() => undefined);
    throw new FaxBundleError('The bundle could not be saved. Nothing was sent. Please try again.', 503);
  }
  await audit(ctx, null, ACTIVITY_EVENT_TYPES.FAX_BUNDLE_PREVIEWED, {
    bundleId: id,
    description: `DC application fax bundle ${reference} prepared: ${items.length === 1 ? '1 application' : `${items.length} applications`} (${items.map((i) => i.caseNumber).join(', ')}) for ${config.destination.name}`,
    record: { reference, destinationId: config.destination.id, destinationAddress: config.destination.address, providerKey: config.provider.key, settingsRevision: config.settingsRevision, caseIds: bundle.caseIds, items: items.map(({ position, caseNumber, documentId, documentVersion, numbering }) => ({ position, caseNumber, documentId, documentVersion, numbering })), pdfChecksumSha256: bundle.pdfChecksumSha256, pdfPageCount: built.pageCount },
  }, mode);
  return viewOf(bundle, mode);
}

// ---------------------------------------------------------------- send

export type FaxSendResult = { duplicate: boolean; recorded: boolean; bundle: FaxBundleView };

async function releaseClaims(bundle: FaxBundle, caseIds: readonly string[], mode: DataAdapterMode): Promise<void> {
  for (const caseId of caseIds) {
    await releaseFaxCaseClaim(bundle.organizationId, caseId, bundle.id, mode).catch((error) =>
      console.error(`Failed to release the fax hold on case ${caseId}:`, error instanceof Error ? error.message : error),
    );
  }
}

/** Puts a send that never reached Outlook back to ready, releasing its cases. */
async function abandonSend(ctx: ActivityContext, bundle: FaxBundle, claimed: readonly string[], action: string, failure: { code: string; message: string } | null, mode: DataAdapterMode): Promise<void> {
  const back = await updateFaxBundleIf(
    bundle,
    { status: 'ready', submissionId: null, sentBy: null, senderAddress: null, outlookContactedAt: null, failureCode: failure?.code ?? null, failureMessage: failure?.message ?? null },
    { actorId: ctx.actorIdentityId, action, note: failure?.message ?? null },
    mode,
  ).catch(() => null);
  // Only once the bundle is back to ready are its cases released.
  if (back) await releaseClaims(bundle, claimed, mode);
}

const CHANGED_SINCE_PREVIEW = 'changed since the preview. Preview the bundle again.';

/**
 * Sends the previewed bundle: one email, one attachment, one fax. See the
 * file header for every safeguard.
 */
export async function sendFaxBundle(ctx: ActivityContext, bundleId: string, submissionId: unknown, mode: DataAdapterMode): Promise<FaxSendResult> {
  const settings = requireSettings(ctx.organizationId);
  if (!settings.sendingEnabled) {
    throw new FaxBundleError('Fax sending is not active yet. It will be turned on once the NuSo sender and a test delivery are verified. Nothing was sent.', 409);
  }
  if (typeof submissionId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(submissionId)) throw new FaxBundleError('A valid submission id is required.', 400);

  let bundle = await getFaxBundle(ctx.organizationId, bundleId, mode);
  if (!bundle) throw new FaxBundleError('Fax bundle not found.', 404);

  // The same request again (double click, refresh, retried call): report it, send nothing.
  if (bundle.submissionId === submissionId && (bundle.status === 'submitted' || bundle.status === 'delivered')) {
    return { duplicate: true, recorded: true, bundle: await viewOf(bundle, mode) };
  }
  if (isAbandonedSendHold(bundle)) {
    await abandonSend(ctx, bundle, bundle.caseIds, 'send_hold_released', null, mode);
    bundle = (await getFaxBundle(ctx.organizationId, bundleId, mode)) ?? bundle;
  }
  const state = faxBundleState(bundle);
  if (state === 'expired') {
    await discard(ctx, bundle, 'preview_expired', mode);
    throw new FaxBundleError('This preview is more than a day old. Preview the bundle again. Nothing was sent.', 409);
  }
  if (state !== 'ready') {
    const message: Record<Exclude<FaxBundleState, 'ready' | 'expired'>, string> = {
      sending: 'This bundle is being sent right now.',
      submitted: 'This bundle was already sent.',
      delivered: 'This bundle was already sent and delivered.',
      needs_review: 'This bundle may already have been sent. It is never sent again automatically — someone allowed to record fax results must record what happened.',
      failed: 'This bundle was not delivered. Preview a new bundle to fax these applications again.',
      discarded: 'This preview is no longer available. Preview the bundle again.',
    };
    throw new FaxBundleError(`${message[state]} Nothing was sent.`, 409);
  }

  // Everything the preview showed, exactly as it was. Fax Settings changed
  // since then (destination, provider, subject or message): nothing is
  // sent — the bundle is never redirected or re-worded; preview again.
  // The bundle's OWN destination is checked: still this organization's,
  // still active, still the same number (null = the default, as before).
  const config = await configurationOf(ctx.organizationId, mode, bundle.destinationId);
  if (config.destination.address !== bundle.destinationAddress || config.provider.key !== bundle.providerKey) {
    throw new FaxBundleError(`The fax destination ${CHANGED_SINCE_PREVIEW} Nothing was sent.`, 409);
  }
  const email = renderBundleEmail(config, { reference: bundle.reference, applicationCount: bundle.applicationCount, pageCount: bundle.pdfPageCount });
  if (email.subject !== bundle.subject || email.body !== bundle.emailBody) throw new FaxBundleError(`The fax email settings ${CHANGED_SINCE_PREVIEW} Nothing was sent.`, 409);
  const applications = await latestApplicationsByCase(ctx.organizationId, mode);
  for (const item of bundle.items) {
    const case_ = await loadCaseOnServer(ctx.organizationId, item.caseId, mode).catch(() => null);
    if (!case_ || case_.isDeleted) throw new FaxBundleError(`${item.caseNumber} is no longer available. Preview the bundle again. Nothing was sent.`, 409);
    const current = applications.get(item.caseId);
    if (!current || current.id !== item.documentId || current.checksumSha256 !== item.documentChecksumSha256) {
      throw new FaxBundleError(`The application for ${item.caseNumber} ${CHANGED_SINCE_PREVIEW} Nothing was sent.`, 409);
    }
  }
  const pdf = await readBundlePdf(bundle);
  if (pdf.byteLength > faxAttachmentLimit(settings)) throw new FaxBundleError('This bundle is larger than the fax limit. Preview a smaller bundle. Nothing was sent.', 413);

  let mailbox: { accessToken: string; accountEmail: string };
  try {
    mailbox = await getCrematoryMailboxAccess(ctx.organizationId, mode);
  } catch (error) {
    if (error instanceof CrematoryMailboxError) throw new FaxBundleError(`Nothing was sent. ${error.message}`, error.status);
    throw error;
  }

  // ready → sending, once. A second request (another click, another tab) finds it taken.
  const sending = await updateFaxBundleIf(bundle, { status: 'sending', submissionId, sentBy: ctx.actorIdentityId, senderAddress: mailbox.accountEmail }, { actorId: ctx.actorIdentityId, action: 'send_started', note: null }, mode);
  if (!sending) {
    const now = await getFaxBundle(ctx.organizationId, bundleId, mode);
    if (now?.submissionId === submissionId && (now.status === 'submitted' || now.status === 'delivered')) return { duplicate: true, recorded: true, bundle: await viewOf(now, mode) };
    throw new FaxBundleError('This bundle is already being sent. Nothing was sent again.', 409);
  }
  bundle = sending;

  // Hold every case for this bundle. One already held elsewhere stops the send.
  const claimed: string[] = [];
  try {
    for (const item of bundle.items) {
      const claim = await claimCaseForFaxBundle(ctx.organizationId, item.caseId, bundle.id, mode);
      if (!claim.claimed) {
        const holder = claim.heldBy ? await getFaxBundle(ctx.organizationId, claim.heldBy, mode) : null;
        // A hold whose bundle no longer holds the case is stale — left behind
        // when releasing it failed after a send that never reached Outlook, or
        // by a send abandoned before Outlook. Provably nothing was sent under
        // it, so it is cleared and the claim tried once more. A bundle that is
        // sending, submitted, needing review or delivered is never touched.
        if (!holder || (await holdingBundle(ctx.organizationId, holder.id, mode)) === null) {
          if (holder && isAbandonedSendHold(holder)) await abandonSend(ctx, holder, holder.caseIds, 'send_hold_released', null, mode);
          else if (claim.heldBy) await releaseFaxCaseClaim(ctx.organizationId, item.caseId, claim.heldBy, mode);
          const retry = await claimCaseForFaxBundle(ctx.organizationId, item.caseId, bundle.id, mode);
          if (retry.claimed) {
            claimed.push(item.caseId);
            continue;
          }
        }
        const current = holder ? await holdingBundle(ctx.organizationId, holder.id, mode) : null;
        const reason = current ? heldReason(current) : 'It is held by another fax bundle.';
        await abandonSend(ctx, bundle, claimed, 'send_refused', null, mode);
        throw new FaxBundleError(`Nothing was sent. ${item.caseNumber}: ${reason}`, 409, [{ caseId: item.caseId, reason }]);
      }
      claimed.push(item.caseId);
    }
    for (const item of bundle.items) await linkCaseToFaxBundle(ctx.organizationId, bundle, item, mode);
  } catch (error) {
    if (error instanceof FaxBundleError) throw error;
    console.error('Failed to hold cases for a fax bundle:', error instanceof Error ? error.message : error);
    await abandonSend(ctx, bundle, claimed, 'send_refused', null, mode);
    throw new FaxBundleError('Nothing was sent. The cases could not be held for this fax. Please try again.', 503);
  }

  // The durable attempt: recorded BEFORE Outlook is contacted, or nothing is sent.
  const contactedAt = new Date().toISOString();
  const attempted = await updateFaxBundleIf(bundle, { outlookContactedAt: contactedAt }, { actorId: ctx.actorIdentityId, action: 'outlook_contacted', note: null, at: contactedAt }, mode).catch(() => null);
  if (!attempted) {
    await abandonSend(ctx, bundle, claimed, 'send_refused', null, mode);
    throw new FaxBundleError('Nothing was sent. The fax could not be recorded before contacting Outlook. Please try again.', 503);
  }
  bundle = attempted;

  let sent: Awaited<ReturnType<typeof sendOutlookMessage>>;
  try {
    sent = await sendOutlookMessage(mailbox.accessToken, {
      to: [bundle.destinationAddress],
      cc: [],
      subject: bundle.subject,
      // The previewed message — '' (none) unless the provider is verified for one.
      bodyText: bundle.emailBody,
      attachments: [{ name: `${bundle.reference}.pdf`, contentType: 'application/pdf', bytes: pdf }],
    });
  } catch (error) {
    // Only an Outlook error that says it could not have sent is "not sent".
    // Anything else — including a dropped connection — may have sent.
    const notSent = error instanceof OutlookMailError && !error.mayHaveSent;
    const reason = error instanceof OutlookMailError ? error.message : 'The connection to Outlook failed.';
    if (notSent) {
      await abandonSend(ctx, bundle, claimed, 'send_failed', { code: 'outlook_not_sent', message: reason }, mode);
      await audit(ctx, null, ACTIVITY_EVENT_TYPES.FAX_BUNDLE_SEND_FAILED, { bundleId: bundle.id, description: `DC application fax bundle ${bundle.reference} was not sent: ${reason}`, record: { reference: bundle.reference, submissionId, error: reason }, severity: 'warning' }, mode);
      throw new FaxBundleError(`${reason} Nothing was sent; press Send Fax to try again.`, 502);
    }
    await updateFaxBundleIf(bundle, { status: 'needs_review', failureCode: 'outlook_uncertain', failureMessage: reason }, { actorId: ctx.actorIdentityId, action: 'send_uncertain', note: reason }, mode).catch(() => null);
    for (const item of bundle.items) {
      await audit(ctx, item.caseId, ACTIVITY_EVENT_TYPES.FAX_BUNDLE_NEEDS_REVIEW, {
        bundleId: bundle.id,
        description: `DC application fax bundle ${bundle.reference} (${item.position} of ${bundle.applicationCount}) may have been sent: ${reason} It will not be sent again until someone allowed to record fax results records what happened.`,
        record: { reference: bundle.reference, submissionId, position: item.position, error: reason, mailbox: mailbox.accountEmail },
        severity: 'warning',
      }, mode);
    }
    throw new FaxBundleError(`${reason} The fax may still have been sent. It will not be sent again until someone allowed to record fax results checks Sent Items in ${mailbox.accountEmail} and NuSo, and records what happened.`, 502);
  }

  // Outlook accepted it. Nothing below can turn that into a resend.
  const submittedAt = new Date().toISOString();
  const submitted = await updateFaxBundleIf(bundle, { status: 'submitted', submittedAt, outlookDraftId: sent.draftId, internetMessageId: sent.internetMessageId }, { actorId: ctx.actorIdentityId, action: 'submitted', note: null, at: submittedAt }, mode).catch(() => null);
  const recorded = submitted !== null;
  for (const item of bundle.items) {
    await audit(ctx, item.caseId, ACTIVITY_EVENT_TYPES.FAX_BUNDLE_SUBMITTED, {
      bundleId: bundle.id,
      description: `DC application faxed to ${bundle.destinationName} (${formatFaxNumber(bundle.destinationFaxNumber)}) in bundle ${bundle.reference} — application ${item.position} of ${bundle.applicationCount}. Submitted to NuSo through ${mailbox.accountEmail}; delivery not yet confirmed${recorded ? '' : '. SOLIS could not save this on the bundle; it needs review'}`,
      record: { reference: bundle.reference, submissionId, position: item.position, applicationCount: bundle.applicationCount, documentId: item.documentId, documentVersion: item.documentVersion, mailbox: mailbox.accountEmail, internetMessageId: sent.internetMessageId, recorded },
      ...(recorded ? {} : { severity: 'warning' as const }),
    }, mode);
  }
  const latest = submitted ?? (await getFaxBundle(ctx.organizationId, bundleId, mode)) ?? bundle;
  return { duplicate: false, recorded, bundle: await viewOf(latest, mode) };
}

// ---------------------------------------------------------------- outcome

export type FaxOutcomeInput = {
  decision: unknown;
  deliveredAt?: unknown;
  nusoReference?: unknown;
  note?: unknown;
  confirmation?: { fileName: string; mimeType: string; bytes: Uint8Array } | null;
};

const CONFIRMATION_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'message/rfc822': 'eml', 'image/png': 'png', 'image/jpeg': 'jpg', 'text/plain': 'txt' };
const MAX_CONFIRMATION_BYTES = 5 * 1024 * 1024;

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
const longLocalDate = (localDate: string) => new Date(`${localDate}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

/**
 * A member with fax.confirm records what NuSo reported. Delivered keeps
 * every case held (never sent again) and completes "Sent day before ashes
 * arrive" with the actual delivery date recorded; Failed releases the cases
 * so they can go in a new bundle. Nothing is sent here.
 */
export async function recordFaxBundleOutcome(ctx: ActivityContext, bundleId: string, input: FaxOutcomeInput, mode: DataAdapterMode): Promise<{ bundle: FaxBundleView; checklistFailed: string[] }> {
  requireSettings(ctx.organizationId);
  // The route checks this too; checked again here from the member's role in
  // this organization (server-side data), so no caller can skip it.
  const allowed = ctx.actorIdentityId && ctx.actorRoleKey ? await canConfirmFax({ identityId: ctx.actorIdentityId, organizationId: ctx.organizationId, roleKey: ctx.actorRoleKey }, mode) : false;
  if (!allowed) throw new FaxBundleError('You are not authorized to record whether a fax was delivered.', 403);
  if (input.decision !== 'delivered' && input.decision !== 'failed') throw new FaxBundleError("decision must be 'delivered' or 'failed'.", 400);
  const decision = input.decision;
  const now = new Date();
  let deliveredAt: string | null = null;
  if (decision === 'delivered') {
    const raw = input.deliveredAt === undefined || input.deliveredAt === null || input.deliveredAt === '' ? now.toISOString() : input.deliveredAt;
    const parsed = typeof raw === 'string' ? Date.parse(raw) : NaN;
    if (Number.isNaN(parsed) || parsed > now.getTime() + 5 * 60 * 1000) throw new FaxBundleError('Enter when NuSo delivered the fax (not in the future).', 400);
    deliveredAt = new Date(parsed).toISOString();
  }
  const nusoReference = typeof input.nusoReference === 'string' && input.nusoReference.trim() ? input.nusoReference.trim() : null;
  if (nusoReference && !/^[A-Za-z0-9 _#./:-]{1,100}$/.test(nusoReference)) throw new FaxBundleError('The NuSo reference can only contain letters, numbers and - _ # . / : (up to 100).', 400);
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null;
  if (note && note.length > 1000) throw new FaxBundleError('Keep the note under 1,000 characters.', 400);

  if (input.confirmation) {
    if (!CONFIRMATION_TYPES[input.confirmation.mimeType]) throw new FaxBundleError('The confirmation must be a PDF, an email (.eml), an image (PNG or JPEG) or a text file.', 400);
    if (input.confirmation.bytes.byteLength === 0 || input.confirmation.bytes.byteLength > MAX_CONFIRMATION_BYTES) throw new FaxBundleError('The confirmation file must be under 5 MB.', 400);
  }

  const bundle = await getFaxBundle(ctx.organizationId, bundleId, mode);
  if (!bundle) throw new FaxBundleError('Fax bundle not found.', 404);
  const state = faxBundleState(bundle);
  if (!canRecordOutcome(state)) {
    throw new FaxBundleError(state === 'delivered' || state === 'failed' ? 'The outcome of this fax was already recorded.' : 'This fax has not been sent, so there is no outcome to record.', 409);
  }
  if (deliveredAt && bundle.outlookContactedAt && Date.parse(deliveredAt) < Date.parse(bundle.outlookContactedAt) - 60 * 1000) {
    throw new FaxBundleError('The delivery time cannot be before the fax was sent.', 400);
  }

  let confirmation: { storageKey: string; fileName: string; checksumSha256: string; sizeBytes: number } | null = null;
  if (input.confirmation) {
    const ext = CONFIRMATION_TYPES[input.confirmation.mimeType];
    const key = `${ctx.organizationId}/fax-bundles/${bundle.id}-confirmation-${crypto.randomUUID()}.${ext}`;
    const { storageKey } = await storeOrganizationFile(ctx.organizationId, key, input.confirmation.bytes, input.confirmation.mimeType);
    confirmation = { storageKey, fileName: input.confirmation.fileName.slice(0, 200), checksumSha256: sha256(input.confirmation.bytes), sizeBytes: input.confirmation.bytes.byteLength };
  }

  const confirmedAt = now.toISOString();
  const updated = await updateFaxBundleIf(
    bundle,
    {
      status: decision,
      confirmedBy: ctx.actorIdentityId,
      confirmedAt,
      deliveredAt,
      nusoReference,
      confirmationDocumentId: confirmation?.storageKey ?? null,
      ...(decision === 'failed' ? { failureCode: 'not_delivered', failureMessage: note ?? 'Recorded as not delivered.' } : {}),
    },
    { actorId: ctx.actorIdentityId, action: decision === 'delivered' ? 'delivery_confirmed' : 'recorded_not_delivered', note, details: { previousState: state, ...(confirmation ? { confirmation } : {}) } },
    mode,
  );
  if (!updated) {
    if (confirmation) await deleteOrganizationFile(ctx.organizationId, confirmation.storageKey).catch(() => undefined);
    throw new FaxBundleError('This fax was just updated by someone else. Reload to see it.', 409);
  }

  const checklistFailed: string[] = [];
  if (decision === 'failed') await releaseClaims(updated, updated.caseIds, mode);
  for (const item of updated.items) {
    if (decision === 'delivered') {
      const pickup = await expectedPickupDate(ctx.organizationId, item.caseId, mode);
      const target = pickup ? dayBefore(pickup) : null;
      await audit(ctx, item.caseId, ACTIVITY_EVENT_TYPES.FAX_BUNDLE_DELIVERED, {
        bundleId: updated.id,
        description: `DC application fax delivered to ${updated.destinationName}: bundle ${updated.reference}, application ${item.position} of ${updated.applicationCount}. Delivery confirmed for ${longDate(deliveredAt!)}${target ? ` (target day was ${longLocalDate(target)})` : ''}${nusoReference ? `, NuSo reference ${nusoReference}` : ''}`,
        record: { reference: updated.reference, position: item.position, deliveredAt, targetDate: target, nusoReference, confirmedBy: ctx.actorIdentityId, note },
      }, mode);
      try {
        await completeChecklistItemsAutomatically(ctx.organizationId, item.caseId, { source: 'workflow_event', eventType: DC_APPLICATION_FAX_DELIVERED_EVENT, eventId: updated.id }, (case_) => dcApplicationSentItem(case_), mode, {
          actor: ctx.actorIdentityId ? { identityId: ctx.actorIdentityId, roleKey: ctx.actorRoleKey } : null,
          correlationId: ctx.correlationId,
        });
        await reconcileCaseWorkflow(ctx.organizationId, item.caseId, mode).catch((error) => console.error('Failed to reconcile workflow after a confirmed fax:', error instanceof Error ? error.message : error));
      } catch (error) {
        console.error(`Fax delivery recorded, but the checklist for case ${item.caseId} could not be saved:`, error instanceof Error ? error.message : error);
        checklistFailed.push(item.caseNumber);
      }
    } else {
      await audit(ctx, item.caseId, ACTIVITY_EVENT_TYPES.FAX_BUNDLE_NOT_DELIVERED, {
        bundleId: updated.id,
        description: `DC application fax bundle ${updated.reference} (application ${item.position} of ${updated.applicationCount}) recorded as not delivered${note ? `: ${note}` : ''}. The application can go in a new bundle.`,
        record: { reference: updated.reference, position: item.position, previousState: state, nusoReference, confirmedBy: ctx.actorIdentityId, note },
        severity: 'warning',
      }, mode);
    }
  }
  return { bundle: await viewOf(updated, mode), checklistFailed };
}

// ---------------------------------------------------------------- case history

export type CaseFaxHistoryEntry = {
  bundleId: string;
  reference: string;
  state: FaxBundleState;
  stateLabel: string;
  position: number;
  applicationCount: number;
  /** Pages in the bundle PDF — the number of fax pages NuSo should report. */
  pageCount: number;
  documentVersion: number | null;
  submittedAt: string | null;
  deliveredAt: string | null;
  failureMessage: string | null;
};

/** Every fax bundle this case's application went out in, newest first. */
export async function listCaseFaxHistory(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<CaseFaxHistoryEntry[]> {
  if (!deathCertificateFaxSettings(organizationId)) return [];
  const ids = await listFaxBundleIdsForCase(organizationId, caseId, mode);
  const entries: CaseFaxHistoryEntry[] = [];
  for (const id of ids) {
    const bundle = await getFaxBundle(organizationId, id, mode);
    const item = bundle?.items.find((i) => i.caseId === caseId);
    if (!bundle || !item) continue;
    const state = faxBundleState(bundle);
    entries.push({
      bundleId: bundle.id,
      reference: bundle.reference,
      state,
      stateLabel: FAX_BUNDLE_STATE_LABEL[state],
      position: item.position,
      applicationCount: bundle.applicationCount,
      pageCount: bundle.pdfPageCount,
      documentVersion: item.documentVersion,
      submittedAt: bundle.submittedAt,
      deliveredAt: bundle.deliveredAt,
      failureMessage: bundle.failureMessage,
    });
  }
  return entries.sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
}
