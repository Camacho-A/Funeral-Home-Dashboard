import { describe, expect, it } from 'vitest';
import { CREMATORY_PENDING_STALE_MS, CREMATORY_SEND_IN_FLIGHT_MS, crematorySendState, sendLockHeld, sendOutcomeNeedingReview } from './sendState';
import type { Case } from '../../types/case';

/** Send to Crematory in the case header (2026-10): the send record decides — never the checklist. */
const NOW = Date.parse('2026-10-30T15:00:00.000Z');
const lastSubmission = (status: string, at = '2026-10-30T14:00:00.000Z') => ({ submissionId: 'sub-1', status, at, by: 'identity-dana' }) as unknown as NonNullable<NonNullable<Case['crematory']>['lastSubmission']>;
const withRecord = (crematory: Case['crematory']): Pick<Case, 'crematory'> => ({ crematory });

describe('crematorySendState', () => {
  it('a case never sent can be opened', () => {
    expect(crematorySendState(withRecord(undefined), NOW)).toEqual({ kind: 'can_open' });
  });

  it('once sent, it is sent — with when — whatever else the record holds', () => {
    expect(crematorySendState(withRecord({ lastSubmission: lastSubmission('submitted') }), NOW)).toEqual({ kind: 'sent', at: '2026-10-30T14:00:00.000Z' });
  });

  it('a send in progress, before Outlook was contacted, disables it until it finishes or its lock goes stale', () => {
    const pending = (startedAt: string) => withRecord({ pendingSubmission: { submissionId: 'sub-2', startedAt, startedBy: 'identity-dana', acknowledgmentId: 'ack' } } as never);
    expect(crematorySendState(pending(new Date(NOW - 30_000).toISOString()), NOW)).toEqual({ kind: 'sending' });
    expect(crematorySendState(pending(new Date(NOW - CREMATORY_PENDING_STALE_MS - 1).toISOString()), NOW)).toEqual({ kind: 'can_open' });
  });

  // Replaced (2026-10, durable duplicate-send protection): an unclear send
  // used to open the window, where staff could confirm and resend. It now
  // needs an administrator's review and is never sendable from the page.
  it('a failed send opens the window; one whose outcome is unclear needs an administrator', () => {
    expect(crematorySendState(withRecord({ lastSubmission: lastSubmission('failed') }), NOW)).toEqual({ kind: 'can_open' });
    expect(crematorySendState(withRecord({ lastSubmission: { ...lastSubmission('uncertain'), mailbox: 'office@example.test' } }), NOW)).toEqual({
      kind: 'needs_review',
      review: { reason: 'uncertain', submissionId: 'sub-1', at: '2026-10-30T14:00:00.000Z', mailbox: 'office@example.test' },
    });
  });

  it('an attempt that reached Outlook and was never recorded never goes stale — it needs an administrator, however long ago', () => {
    const contacted = (at: string) =>
      withRecord({
        pendingSubmission: { submissionId: 'sub-3', startedAt: at, startedBy: 'identity-dana', acknowledgmentId: 'ack', outlookContactedAt: at, attempt: { mailbox: 'office@example.test' } },
      } as never);
    // Just handed to Outlook: shown as sending.
    expect(crematorySendState(contacted(new Date(NOW - 10_000).toISOString()), NOW)).toEqual({ kind: 'sending' });
    for (const ago of [CREMATORY_SEND_IN_FLIGHT_MS + 1, CREMATORY_PENDING_STALE_MS + 1, 30 * 24 * 60 * 60 * 1000]) {
      const at = new Date(NOW - ago).toISOString();
      expect(crematorySendState(contacted(at), NOW)).toEqual({ kind: 'needs_review', review: { reason: 'unrecorded', submissionId: 'sub-3', at, mailbox: 'office@example.test' } });
      expect(sendLockHeld(contacted(at).crematory, NOW)).toBe(true);
    }
  });

  it('a lock taken before Outlook was contacted is not a send to review', () => {
    const pending = withRecord({ pendingSubmission: { submissionId: 'sub-4', startedAt: new Date(NOW - 1000).toISOString(), startedBy: null } } as never);
    expect(sendOutcomeNeedingReview(pending.crematory)).toBeNull();
    expect(sendLockHeld(pending.crematory, NOW)).toBe(true);
    expect(sendLockHeld(pending.crematory, NOW + CREMATORY_PENDING_STALE_MS + 1000)).toBe(false);
  });

  it('a sent case is sent, even if a stray attempt record remains', () => {
    const record = { lastSubmission: lastSubmission('submitted'), pendingSubmission: { submissionId: 'x', startedAt: '2026-10-30T13:00:00.000Z', startedBy: null, outlookContactedAt: '2026-10-30T13:00:00.000Z' } } as never;
    expect(crematorySendState(withRecord(record), NOW).kind).toBe('sent');
  });
});
