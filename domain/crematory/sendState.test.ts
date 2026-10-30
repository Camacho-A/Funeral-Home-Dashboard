import { describe, expect, it } from 'vitest';
import { CREMATORY_PENDING_STALE_MS, crematorySendState } from './sendState';
import type { Case } from '../../types/case';

/** Send to Crematory in the case header (2026-10): the send record decides — never the checklist. */
const NOW = Date.parse('2026-10-30T15:00:00.000Z');
const lastSubmission = (status: string, at = '2026-10-30T14:00:00.000Z') => ({ submissionId: 'sub-1', status, at, by: 'identity-dana' }) as never;
const withRecord = (crematory: Case['crematory']): Pick<Case, 'crematory'> => ({ crematory });

describe('crematorySendState', () => {
  it('a case never sent can be opened', () => {
    expect(crematorySendState(withRecord(undefined), NOW)).toEqual({ kind: 'can_open' });
  });

  it('once sent, it is sent — with when — whatever else the record holds', () => {
    expect(crematorySendState(withRecord({ lastSubmission: lastSubmission('submitted') }), NOW)).toEqual({ kind: 'sent', at: '2026-10-30T14:00:00.000Z' });
  });

  it('a send in progress disables it until it finishes or its lock goes stale', () => {
    const pending = (startedAt: string) => withRecord({ pendingSubmission: { submissionId: 'sub-2', startedAt, startedBy: 'identity-dana', acknowledgmentId: 'ack' } } as never);
    expect(crematorySendState(pending(new Date(NOW - 30_000).toISOString()), NOW)).toEqual({ kind: 'sending' });
    expect(crematorySendState(pending(new Date(NOW - CREMATORY_PENDING_STALE_MS - 1).toISOString()), NOW)).toEqual({ kind: 'can_open' });
  });

  it('a failed send, or one whose outcome is unclear, opens the window (which handles the unclear case)', () => {
    expect(crematorySendState(withRecord({ lastSubmission: lastSubmission('failed') }), NOW)).toEqual({ kind: 'can_open' });
    expect(crematorySendState(withRecord({ lastSubmission: lastSubmission('uncertain') }), NOW)).toEqual({ kind: 'can_open' });
  });
});
