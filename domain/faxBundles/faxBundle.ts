/**
 * Manatee County DC application fax bundles (2026-11) — the bundle record
 * and its statuses. One bundle = one combined PDF = one email = one fax.
 * Every included case links to the same bundle; there is never a separate
 * per-case transmission record.
 *
 * Statuses:
 *   ready         the exact PDF is built, stored and previewable
 *   sending       Send Fax is in progress (the bundle and its cases are held)
 *   submitted     Outlook accepted the email for NuSo — NOT proof of delivery
 *   delivered     an Administrator/Manager confirmed NuSo delivered it
 *   failed        not delivered (confirmed), or never sent
 *   needs_review  it may have gone out and SOLIS cannot tell — never retried
 *   discarded     an unsent preview that expired or was replaced
 *
 * Two states are derived, never stored, so they cannot drift:
 *   - a `sending` bundle whose attempt reached Outlook (outlookContactedAt)
 *     and whose outcome was never recorded reads as needs_review;
 *   - a `ready` preview older than PREVIEW_TTL_MS reads as expired.
 */

export const FAX_BUNDLE_PURPOSE = 'manatee_dc_application';

export type FaxBundleStatus = 'ready' | 'sending' | 'submitted' | 'delivered' | 'failed' | 'needs_review' | 'discarded';
export type FaxBundleState = FaxBundleStatus | 'expired';

/** How an application's "Request ___ of ___" boxes were numbered in the bundle copy. */
export type RequestNumbering = 'filled_blank' | 'replaced_existing';

export type FaxBundleItem = {
  /** 1-based, in the order staff chose. */
  position: number;
  caseId: string;
  caseNumber: string;
  documentId: string;
  documentVersion: number | null;
  documentChecksumSha256: string;
  pageCount: number;
  numbering: RequestNumbering;
};

export type FaxBundleHistoryEntry = {
  at: string;
  actorId: string | null;
  action: string;
  fromStatus: FaxBundleStatus | null;
  toStatus: FaxBundleStatus;
  note: string | null;
  details?: Record<string, unknown>;
};

export type FaxBundle = {
  id: string;
  organizationId: string;
  reference: string;
  purpose: typeof FAX_BUNDLE_PURPOSE;
  status: FaxBundleStatus;
  revision: number;
  items: FaxBundleItem[];
  caseIds: string[];
  applicationCount: number;
  pdfStorageKey: string;
  pdfChecksumSha256: string;
  pdfSizeBytes: number;
  pdfPageCount: number;
  destinationName: string;
  destinationFaxNumber: string;
  destinationAddress: string;
  gatewayDomain: string;
  subject: string;
  /** Fax Settings (2026-11) — what the preview was prepared with, kept on the
      bundle so a later settings change can never alter or redirect it.
      Rows prepared before Fax Settings read as: destinationId null (the
      built-in destination), providerKey 'nuso', emailBody '' (none),
      settingsRevision null. */
  destinationId: string | null;
  providerKey: string;
  /** Plain text; '' = no message (the default, and always for NuSo today). */
  emailBody: string;
  settingsRevision: number | null;
  senderAddress: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  submissionId: string | null;
  sentBy: string | null;
  outlookContactedAt: string | null;
  submittedAt: string | null;
  outlookDraftId: string | null;
  internetMessageId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  deliveredAt: string | null;
  nusoReference: string | null;
  confirmationDocumentId: string | null;
  history: FaxBundleHistoryEntry[];
};

/** An unsent preview may be sent for this long; then it must be previewed again. */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
/** A send that never reached Outlook releases its hold after this long —
    nothing can have been sent. One that reached Outlook never does. */
export const SEND_HOLD_STALE_MS = 5 * 60 * 1000;

export function faxBundleState(bundle: Pick<FaxBundle, 'status' | 'createdAt' | 'updatedAt' | 'outlookContactedAt'>, now = Date.now()): FaxBundleState {
  if (bundle.status === 'ready' && now - Date.parse(bundle.createdAt) > PREVIEW_TTL_MS) return 'expired';
  if (bundle.status === 'sending' && bundle.outlookContactedAt && now - Date.parse(bundle.outlookContactedAt) > SEND_HOLD_STALE_MS) return 'needs_review';
  return bundle.status;
}

/** A send in progress that never reached Outlook and was abandoned — safe to release. */
export function isAbandonedSendHold(bundle: Pick<FaxBundle, 'status' | 'updatedAt' | 'outlookContactedAt'>, now = Date.now()): boolean {
  return bundle.status === 'sending' && !bundle.outlookContactedAt && now - Date.parse(bundle.updatedAt) > SEND_HOLD_STALE_MS;
}

export const FAX_BUNDLE_STATE_LABEL: Record<FaxBundleState, string> = {
  ready: 'Ready to Send',
  sending: 'Sending',
  submitted: 'Submitted to NuSo',
  delivered: 'Confirmed Delivered',
  failed: 'Failed',
  needs_review: 'Delivery Unknown / Needs Review',
  discarded: 'Discarded',
  expired: 'Preview expired',
};

/** Statuses an Administrator/Manager may record an outcome from. */
export function canRecordOutcome(state: FaxBundleState): boolean {
  return state === 'submitted' || state === 'needs_review';
}

/** "DC-7Q4K9M": short, random, unambiguous to read aloud — no case information. */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newFaxBundleReference(random: (n: number) => Uint8Array): string {
  const bytes = random(6);
  return `DC-${Array.from(bytes, (b) => REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length]).join('')}`;
}
export const FAX_BUNDLE_REFERENCE_PATTERN = /^DC-[2-9A-HJKMNP-TV-Z]{6}$/;

/** "2026-11-10" → "2026-11-09" (calendar arithmetic only). */
export function dayBefore(localDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return null;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1));
  return d.toISOString().slice(0, 10);
}
