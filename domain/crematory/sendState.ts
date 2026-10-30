import type { Case, CaseCrematoryRecord } from '../../types/case';

/**
 * Send to Crematory — what the case's own send record says (2026-10).
 *
 * The send record is the only source of truth for whether a case can be
 * sent again: never the checklist. Once Outlook accepted the email
 * ("submitted") the case is sent, permanently — the button stays disabled
 * after any refresh, and the server refuses another send whatever the
 * checklist says.
 *
 * Duplicate-send protection (2026-10). Before Outlook is contacted, the
 * attempt is recorded durably on every case (`outlookContactedAt`). From
 * that moment the email may have gone out, so:
 *   - an attempt whose outcome was never recorded (the server stopped, or
 *     Outlook accepted it but saving "submitted" failed) NEVER expires;
 *   - nor does a send Outlook itself left unclear ("uncertain");
 *   - either blocks every further send until an administrator checks Sent
 *     Items and resolves it as sent or not sent (reconcileCrematorySend).
 * Only a lock taken BEFORE Outlook was contacted — when nothing can have
 * been sent — expires on its own, after CREMATORY_PENDING_STALE_MS.
 */

/** A lock older than this, taken before Outlook was ever contacted, is a
    send that stopped before sending anything — the case is free again. */
export const CREMATORY_PENDING_STALE_MS = 10 * 60 * 1000;

/** For the page only: how long an attempt that reached Outlook is shown as
    "sending" before it is shown as needing review. The server blocks
    another send either way. */
export const CREMATORY_SEND_IN_FLIGHT_MS = 2 * 60 * 1000;

type Record_ = CaseCrematoryRecord | null | undefined;

export type SendOutcomeReview = {
  /** 'uncertain': Outlook said it may have been sent. 'unrecorded': the
      attempt reached Outlook and its result was never recorded. */
  reason: 'uncertain' | 'unrecorded';
  submissionId: string;
  at: string;
  mailbox: string | null;
};

/** A send that may have reached the crematory and whose outcome SOLIS could
    not confirm — blocks sending until an administrator resolves it. */
export function sendOutcomeNeedingReview(record: Record_): SendOutcomeReview | null {
  if (record?.lastSubmission?.status === 'submitted') return null;
  const pending = record?.pendingSubmission;
  if (pending?.outlookContactedAt) {
    return { reason: 'unrecorded', submissionId: pending.submissionId, at: pending.outlookContactedAt, mailbox: pending.attempt?.mailbox ?? null };
  }
  const last = record?.lastSubmission;
  if (last?.status === 'uncertain') return { reason: 'uncertain', submissionId: last.submissionId, at: last.at, mailbox: last.mailbox };
  return null;
}

/** A send lock that still holds the case: any attempt that reached Outlook
    (forever), or one taken before that within CREMATORY_PENDING_STALE_MS. */
export function sendLockHeld(record: Record_, nowMs: number = Date.now()): boolean {
  const pending = record?.pendingSubmission;
  if (!pending) return false;
  if (pending.outlookContactedAt) return true;
  return nowMs - Date.parse(pending.startedAt) < CREMATORY_PENDING_STALE_MS;
}

export const SEND_NEEDS_REVIEW_MESSAGE =
  'The last send may have reached the crematory, but SOLIS could not confirm it. An administrator must check Sent Items in the mailbox and record whether it was sent before this case can be sent again.';

export type CrematorySendState =
  | { kind: 'sent'; at: string }
  | { kind: 'sending' }
  | { kind: 'needs_review'; review: SendOutcomeReview }
  | { kind: 'can_open' };

export function crematorySendState(case_: Pick<Case, 'crematory'>, nowMs: number = Date.now()): CrematorySendState {
  const record = case_.crematory;
  if (record?.lastSubmission?.status === 'submitted') return { kind: 'sent', at: record.lastSubmission.at };
  const review = sendOutcomeNeedingReview(record);
  if (review) {
    // An attempt that reached Outlook a moment ago is most likely still
    // finishing; shown as sending until it has had time to.
    if (review.reason === 'unrecorded' && nowMs - Date.parse(review.at) < CREMATORY_SEND_IN_FLIGHT_MS) return { kind: 'sending' };
    return { kind: 'needs_review', review };
  }
  if (sendLockHeld(record, nowMs)) return { kind: 'sending' };
  return { kind: 'can_open' };
}

/** "Sent Oct 30, 2026, 2:15 PM" — local time, for the case header. */
export function formatCrematorySentAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
