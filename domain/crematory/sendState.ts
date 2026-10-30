import type { Case } from '../../types/case';

/**
 * Send to Crematory — what the case's own send record says (2026-10).
 *
 * The send record is the only source of truth for whether a case can be
 * sent again: never the checklist. Once Outlook accepted the email
 * ("submitted") the case is sent, permanently — the button stays disabled
 * after any refresh, and the server refuses another send whatever the
 * checklist says. A send in progress (another staff member, or this one
 * a moment ago) disables it too, until it finishes or its lock goes stale.
 */

/** A lock older than this is a send that never finished (the server process
    ended mid-send) — the case is no longer treated as being sent. */
export const CREMATORY_PENDING_STALE_MS = 10 * 60 * 1000;

export type CrematorySendState =
  | { kind: 'sent'; at: string }
  | { kind: 'sending' }
  | { kind: 'can_open' };

export function crematorySendState(case_: Pick<Case, 'crematory'>, nowMs: number = Date.now()): CrematorySendState {
  const record = case_.crematory;
  if (record?.lastSubmission?.status === 'submitted') return { kind: 'sent', at: record.lastSubmission.at };
  const pending = record?.pendingSubmission;
  if (pending && nowMs - Date.parse(pending.startedAt) < CREMATORY_PENDING_STALE_MS) return { kind: 'sending' };
  return { kind: 'can_open' };
}

/** "Sent Oct 30, 2026, 2:15 PM" — local time, for the case header. */
export function formatCrematorySentAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
