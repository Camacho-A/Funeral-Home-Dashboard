import { describe, expect, it } from 'vitest';
import {
  appendReleaseEvent,
  correctableSignOffs,
  correctionConfirmationRefusal,
  currentHold,
  isHeldStatus,
  isReleasedStatus,
  pendingCorrection,
  pendingReleaseRequest,
  releaseEventsOf,
  releaseStatusOf,
  responsibleForSignOff,
  ReleaseTransitionError,
  RELEASE_EVENT_ALLOWED_FROM,
} from './releaseHolds';
import { applyPreparationChange, PreparationChangeError } from './preparationUpdates';
import { releaseGateRefusal } from './releaseForCremation';
import { VIEWING_PREPARATION } from './serviceDefinitions';
import { SERVICE_TYPE_CODES } from '../workflow/serviceWorkflows';
import type { Case } from '../../types/case';
import type { ReleaseApprovalSnapshot, ReleaseEvent, ReleaseEventType, ServicePreparationRecord } from './types';

/** The release-hold workflow (Gus, 2026-11) — pure rules, fictional people. */
const approval: ReleaseApprovalSnapshot = {
  staffProfileId: 'staff-gus-director',
  basis: 'funeral_director_role',
  licenseNumber: 'FD-FICTIONAL-0001',
  licenseState: 'FL',
  licenseExpiresOn: '2030-01-31',
  licenseVerifiedAt: '2026-11-01T00:00:00.000Z',
  licenseVerifiedBy: 'identity-gus-admin',
  serviceAppointmentId: 'appt-viewing',
  prerequisites: [{ key: 'service_completed', label: 'Viewing marked completed' }],
};
let n = 0;
const event = (type: ReleaseEventType, extra: Partial<ReleaseEvent> = {}): ReleaseEvent => ({
  eventId: `e${++n}`,
  type,
  at: `2026-12-1${n % 10}T15:00:00.000Z`,
  actorId: 'identity-x',
  actorName: 'Fictional Staff',
  roleKey: 'manager',
  ...(type === 'released' || type === 'reauthorized' ? { approval } : {}),
  ...(type === 'hold_placed' ? { reason: 'Family asked to wait' } : {}),
  ...extra,
});
const apply = (record: ServicePreparationRecord | null, e: ReleaseEvent) => appendReleaseEvent({ definition: VIEWING_PREPARATION, record, event: e });
const run = (...types: ReleaseEventType[]) => types.reduce<ServicePreparationRecord | null>((r, t) => apply(r, event(t)), null)!;

describe('release-hold workflow', () => {
  it('request → sign-off → hold → request reauthorization → reauthorized; every step appended, nothing rewritten', () => {
    let record = apply(null, event('release_requested'));
    expect(releaseStatusOf(record)).toBe('awaiting_signoff');
    expect(record.release ?? null).toBeNull();
    record = apply(record, event('released'));
    const original = structuredClone(record.release);
    expect(releaseStatusOf(record)).toBe('released');
    record = apply(record, event('hold_placed'));
    expect(releaseStatusOf(record)).toBe('on_hold');
    expect(currentHold(record)!.reason).toBe('Family asked to wait');
    record = apply(record, event('reauthorization_requested'));
    expect(releaseStatusOf(record)).toBe('awaiting_reauthorization');
    expect(currentHold(record)).not.toBeNull();
    record = apply(record, event('reauthorized'));
    expect(releaseStatusOf(record)).toBe('reauthorized');
    expect(currentHold(record)).toBeNull();
    expect(record.release).toEqual(original);
    expect(record.releaseEvents!.map((e) => e.type)).toEqual(['release_requested', 'released', 'hold_placed', 'reauthorization_requested', 'reauthorized']);
    expect(record.history!.map((h) => h.target.key)).toEqual(record.releaseEvents!.map((e) => e.type));
    // Each history entry names the step before it.
    expect((record.history![2].previous as ReleaseEvent).type).toBe('released');
  });

  it('a second hold, and a second reauthorization, keep appending', () => {
    const record = run('released', 'hold_placed', 'reauthorized', 'hold_placed', 'reauthorized');
    expect(record.releaseEvents).toHaveLength(5);
    expect(releaseStatusOf(record)).toBe('reauthorized');
  });

  it('only released states send: on hold and pending requests do not', () => {
    expect(isReleasedStatus('released')).toBe(true);
    expect(isReleasedStatus('reauthorized')).toBe(true);
    for (const s of ['not_released', 'awaiting_signoff', 'on_hold', 'awaiting_reauthorization'] as const) expect(isReleasedStatus(s)).toBe(false);
  });

  it('refuses steps out of order: no duplicate release, no hold before release, no reauthorization without a hold', () => {
    expect(() => apply(run('released'), event('released'))).toThrow(ReleaseTransitionError);
    expect(() => apply(run('released'), event('release_requested'))).toThrow(ReleaseTransitionError);
    expect(() => apply(null, event('hold_placed'))).toThrow(ReleaseTransitionError);
    expect(() => apply(run('release_requested'), event('hold_placed'))).toThrow(ReleaseTransitionError);
    expect(() => apply(run('released'), event('reauthorized'))).toThrow(ReleaseTransitionError);
    expect(() => apply(run('released', 'hold_placed'), event('hold_placed'))).toThrow(ReleaseTransitionError);
  });

  it('a hold needs a reason; a sign-off needs its approval', () => {
    expect(() => apply(run('released'), event('hold_placed', { reason: '   ' }))).toThrow(/reason/);
    expect(() => apply(null, event('released', { approval: null }))).toThrow(/sign-off/);
    expect(() => apply(run('released', 'hold_placed'), event('reauthorized', { approval: null }))).toThrow(/sign-off/);
  });

  it('records that paperwork had already gone, when it had', () => {
    const record = apply(run('released'), event('hold_placed', { paperworkAlreadyTransmitted: true }));
    expect(currentHold(record)!.paperworkAlreadyTransmitted).toBe(true);
    expect(record.history!.at(-1)!.description).toMatch(/crematory must be contacted/);
  });

  it('a record released before holds existed reads as released', () => {
    const legacy = { definitionKey: 'prep.viewing', definitionVersion: 2, serviceAppointmentId: null, choices: {}, details: {}, items: {}, release: { releasedAt: '2026-12-01T00:00:00.000Z', releasedBy: 'identity-gus-director', releasedByName: 'Jordan Demo', roleKey: 'funeralDirector' } };
    expect(releaseStatusOf(legacy)).toBe('released');
    expect(releaseEventsOf(legacy)).toHaveLength(1);
    const held = apply(legacy, event('hold_placed'));
    expect(held.releaseEvents!.map((e) => e.type)).toEqual(['released', 'hold_placed']);
    expect(held.release).toEqual(legacy.release);
  });

  it('every transition rule is covered', () => {
    expect(Object.keys(RELEASE_EVENT_ALLOWED_FROM).sort()).toEqual([
      'correction_requested',
      'correction_withdrawn',
      'hold_placed',
      'reauthorization_requested',
      'reauthorized',
      'release_corrected',
      'release_requested',
      'released',
      'request_withdrawn',
    ]);
  });
});

describe('withdrawing a pending request', () => {
  it('a release request goes back to Not released, and can be asked again', () => {
    const requested = run('release_requested');
    const withdrawn = apply(requested, event('request_withdrawn', { reason: 'Asked too early' }));
    expect(releaseStatusOf(withdrawn)).toBe('not_released');
    expect(pendingReleaseRequest(withdrawn)).toBeNull();
    // It names the request it withdrew, and the request stays in the history.
    expect(withdrawn.releaseEvents!.at(-1)!.withdrawsEventId).toBe(requested.releaseEvents![0].eventId);
    expect(withdrawn.releaseEvents!.map((e) => e.type)).toEqual(['release_requested', 'request_withdrawn']);
    expect(releaseStatusOf(apply(withdrawn, event('release_requested')))).toBe('awaiting_signoff');
  });

  it('a reauthorization request goes back to On hold — the hold stays in force', () => {
    const withdrawn = apply(run('released', 'hold_placed', 'reauthorization_requested'), event('request_withdrawn'));
    expect(releaseStatusOf(withdrawn)).toBe('on_hold');
    expect(currentHold(withdrawn)!.type).toBe('hold_placed');
  });

  it('nothing pending: refused', () => {
    expect(() => apply(run('released'), event('request_withdrawn'))).toThrow(ReleaseTransitionError);
    expect(() => apply(null, event('request_withdrawn'))).toThrow(ReleaseTransitionError);
  });
});

describe('correcting a recorded sign-off', () => {
  it('the sign-off in force on an active release cannot be corrected directly — it must be requested and independently confirmed', () => {
    const released = run('released');
    const signOff = released.releaseEvents![0];
    expect(() => apply(released, event('release_corrected', { reason: 'Wrong appointment', correctsEventId: signOff.eventId }))).toThrow(/confirmation/);
  });

  it('an earlier, superseded sign-off: annotated, status unchanged', () => {
    const record = run('released', 'hold_placed', 'reauthorized');
    const first = record.releaseEvents![0];
    const corrected = apply(record, event('release_corrected', { reason: 'Wrong approver selected', correctsEventId: first.eventId }));
    expect(releaseStatusOf(corrected)).toBe('reauthorized');
    expect(correctableSignOffs(corrected).map((e) => e.type)).toEqual(['reauthorized']);
  });

  it('refused without a reason, for a non-sign-off event, or twice for the same sign-off', () => {
    const released = run('released');
    const id = released.releaseEvents![0].eventId;
    expect(() => apply(released, event('correction_requested', { correctsEventId: id }))).toThrow(/reason/);
    const held = run('released', 'hold_placed');
    const heldId = held.releaseEvents![0].eventId;
    expect(() => apply(held, event('release_corrected', { correctsEventId: heldId }))).toThrow(/reason/);
    expect(() => apply(held, event('release_corrected', { reason: 'x', correctsEventId: held.releaseEvents![1].eventId }))).toThrow(ReleaseTransitionError);
    // While on hold the release is not active: recorded at once.
    const once = apply(held, event('release_corrected', { reason: 'x', correctsEventId: heldId }));
    expect(releaseStatusOf(once)).toBe('on_hold');
    expect(() => apply(once, event('release_corrected', { reason: 'again', correctsEventId: heldId }))).toThrow(ReleaseTransitionError);
    expect(() => apply(null, event('release_corrected', { reason: 'x', correctsEventId: 'nope' }))).toThrow(ReleaseTransitionError);
  });
});

describe('independent confirmation of a correction affecting an active release', () => {
  // A (requester) asked for the release, B (licensed director) signed it off.
  const activeRelease = () => {
    const requested = apply(null, event('release_requested', { actorId: 'identity-a' }));
    return apply(requested, event('released', { actorId: 'identity-b' }));
  };
  const request = (record: ServicePreparationRecord, actorId = 'identity-c') =>
    apply(record, event('correction_requested', { actorId, reason: 'Signed against the wrong appointment', correctsEventId: record.releaseEvents!.at(-1)!.eventId, paperworkAlreadyTransmitted: false }));
  const confirm = (record: ServicePreparationRecord, actorId: string) => {
    const pending = pendingCorrection(record)!;
    return apply(record, event('release_corrected', { actorId, reason: pending.reason, correctsEventId: pending.correctsEventId, confirmsEventId: pending.eventId }));
  };

  it('the request blocks sending at once, without changing the sign-off', () => {
    const released = activeRelease();
    const pending = request(released);
    expect(releaseStatusOf(pending)).toBe('correction_pending');
    expect(isReleasedStatus('correction_pending')).toBe(false);
    expect(isHeldStatus('correction_pending')).toBe(true);
    expect(currentHold(pending)!.type).toBe('correction_requested');
    expect(pending.release).toEqual(released.release);
    expect(pending.releaseEvents!.slice(0, 2)).toEqual(released.releaseEvents);
    expect(pending.history!.at(-1)!.description).toMatch(/sending blocked until someone else confirms/);
  });

  it('the people responsible for the release are its signer and whoever requested it', () => {
    const released = activeRelease();
    expect(responsibleForSignOff(released, released.releaseEvents![1].eventId).sort()).toEqual(['identity-a', 'identity-b']);
  });

  it('refused for the requester, the licensed signer, and whoever requested the release; allowed for anyone else', () => {
    const pending = request(activeRelease());
    expect(correctionConfirmationRefusal(pending, 'identity-c')).toMatch(/You asked for this correction/);
    expect(correctionConfirmationRefusal(pending, 'identity-b')).toMatch(/responsible for the release/);
    expect(correctionConfirmationRefusal(pending, 'identity-a')).toMatch(/responsible for the release/);
    expect(correctionConfirmationRefusal(pending, 'identity-d')).toBeNull();
    for (const actorId of ['identity-a', 'identity-b', 'identity-c']) expect(() => confirm(pending, actorId), actorId).toThrow(ReleaseTransitionError);
  });

  it('the signer may report their own mistake, but still cannot confirm it', () => {
    const pending = request(activeRelease(), 'identity-b');
    expect(() => confirm(pending, 'identity-b')).toThrow(/You asked/);
    expect(() => confirm(pending, 'identity-a')).toThrow(/responsible/);
    expect(releaseStatusOf(confirm(pending, 'identity-d'))).toBe('on_hold');
  });

  it('confirmed by someone independent: appended, release on hold; only a licensed reauthorization lifts it; history intact', () => {
    const released = activeRelease();
    const pending = request(released);
    const confirmed = confirm(pending, 'identity-d');
    expect(releaseStatusOf(confirmed)).toBe('on_hold');
    expect(currentHold(confirmed)).toMatchObject({ type: 'release_corrected', confirmsEventId: pending.releaseEvents!.at(-1)!.eventId });
    expect(correctableSignOffs(confirmed)).toEqual([]);
    expect(confirmed.release).toEqual(released.release);
    expect(confirmed.releaseEvents!.map((e) => e.type)).toEqual(['release_requested', 'released', 'correction_requested', 'release_corrected']);
    expect(confirmed.history!.at(-1)!.description).toMatch(/Correction confirmed by/);
    // A reauthorization needs the licensed sign-off (approval) — refused without it.
    expect(() => apply(confirmed, event('reauthorized', { approval: null }))).toThrow(/licensed/);
    expect(releaseStatusOf(apply(confirmed, event('reauthorized', { actorId: 'identity-e' })))).toBe('reauthorized');
  });

  it('while pending: no other correction, hold, release step or preparation change; only confirm or withdraw', () => {
    const pending = request(activeRelease());
    const signOffId = pending.releaseEvents![1].eventId;
    expect(() => apply(pending, event('release_corrected', { actorId: 'identity-d', reason: 'x', correctsEventId: signOffId }))).toThrow(/awaiting confirmation/);
    expect(() => apply(pending, event('correction_requested', { reason: 'x', correctsEventId: signOffId }))).toThrow(ReleaseTransitionError);
    for (const type of ['hold_placed', 'reauthorization_requested', 'reauthorized', 'release_requested', 'released', 'request_withdrawn'] as const) {
      expect(() => apply(pending, event(type)), type).toThrow(ReleaseTransitionError);
    }
    const change = { kind: 'item' as const, itemId: 'prep.embalming.written_permission', status: 'pending' as const };
    expect(() =>
      applyPreparationChange({ definition: VIEWING_PREPARATION, record: pending, service: null, change, actor: { id: 'identity-x', name: 'Fictional Staff' }, now: '2026-12-20T10:00:00.000Z', eventId: 'p-pending', reason: 'x' }),
    ).toThrow(/awaiting confirmation/);
  });

  it('withdrawn by the requester (no reason needed) or declined by someone else (reason required): the release stands as signed', () => {
    const released = activeRelease();
    const pending = request(released);
    const withdrawn = apply(pending, event('correction_withdrawn', { actorId: 'identity-c' }));
    expect(releaseStatusOf(withdrawn)).toBe('released');
    expect(withdrawn.releaseEvents!.at(-1)!.withdrawsEventId).toBe(pending.releaseEvents!.at(-1)!.eventId);
    expect(correctableSignOffs(withdrawn).map((e) => e.eventId)).toEqual([released.releaseEvents![1].eventId]);
    expect(() => apply(pending, event('correction_withdrawn', { actorId: 'identity-d' }))).toThrow(/reason for declining/);
    expect(releaseStatusOf(apply(pending, event('correction_withdrawn', { actorId: 'identity-d', reason: 'The sign-off was right' })))).toBe('released');
    // A reauthorized release returns to reauthorized.
    const reauthorized = apply(apply(released, event('hold_placed')), event('reauthorized', { actorId: 'identity-b' }));
    const again = apply(request(reauthorized), event('correction_withdrawn', { actorId: 'identity-c' }));
    expect(releaseStatusOf(again)).toBe('reauthorized');
  });

  it('a confirmation claimed with no pending request, or for a different request, is refused', () => {
    const released = activeRelease();
    expect(() => apply(released, event('release_corrected', { actorId: 'identity-d', reason: 'x', correctsEventId: released.releaseEvents![1].eventId, confirmsEventId: 'nope' }))).toThrow(ReleaseTransitionError);
    const pending = request(released);
    const p = pendingCorrection(pending)!;
    expect(() => apply(pending, event('release_corrected', { actorId: 'identity-d', reason: 'x', correctsEventId: p.correctsEventId, confirmsEventId: 'other' }))).toThrow(/confirm or withdraw/);
  });

  it('the crematory gate refuses while a correction is pending', () => {
    const viewing = { workflowSnapshot: { serviceTypeCode: SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING } as Case['workflowSnapshot'], servicePreparation: request(activeRelease()) };
    expect(releaseGateRefusal(viewing, true)).toMatch(/Signed against the wrong appointment/);
  });
});

describe('preparation changes and the release status', () => {
  const change = { kind: 'item' as const, itemId: 'prep.embalming.written_permission', status: 'pending' as const };
  const prep = (record: ServicePreparationRecord | null, reason?: string) =>
    applyPreparationChange({ definition: VIEWING_PREPARATION, record, service: null, change, actor: { id: 'identity-x', name: 'Fictional Staff' }, now: '2026-12-20T10:00:00.000Z', eventId: `p${++n}`, reason });

  it('released or reauthorized: read-only', () => {
    expect(() => prep(run('released'), 'x')).toThrow(PreparationChangeError);
    expect(() => prep(run('released', 'hold_placed', 'reauthorized'), 'x')).toThrow(PreparationChangeError);
  });

  it('on hold: allowed with a reason, recorded in the history as made during the hold', () => {
    const held = run('released', 'hold_placed');
    expect(() => prep(held)).toThrow(/reason/);
    const changed = prep(held, 'Family changed the clothing');
    const entry = changed.history!.at(-1)!;
    expect(entry).toMatchObject({ duringHold: true, reason: 'Family changed the clothing' });
    expect(entry.description).toContain('reauthorization required');
    // Still on hold — only a reauthorization lifts it.
    expect(releaseStatusOf(changed)).toBe('on_hold');
  });

  it('a pending reauthorization request: read-only until it is withdrawn', () => {
    const pending = run('released', 'hold_placed', 'reauthorization_requested');
    expect(() => prep(pending, 'x')).toThrow(/Withdraw/);
    expect(() => prep(apply(pending, event('request_withdrawn')), 'Fix clothing')).not.toThrow();
  });

  it('before any release: unchanged — no reason needed', () => {
    expect(prep(null).history!.at(-1)!.duringHold).toBeUndefined();
  });
});

describe('releaseGateRefusal', () => {
  const viewing = (servicePreparation: ServicePreparationRecord | null) => ({ workflowSnapshot: { serviceTypeCode: SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING } as Case['workflowSnapshot'], servicePreparation });
  it('off: never refuses', () => expect(releaseGateRefusal(viewing(null), false)).toBeNull());
  it('on: refuses until released, refuses again on hold, allows once reauthorized', () => {
    expect(releaseGateRefusal(viewing(null), true)).toMatch(/must be released/);
    expect(releaseGateRefusal(viewing(run('released')), true)).toBeNull();
    expect(releaseGateRefusal(viewing(run('released', 'hold_placed')), true)).toMatch(/on hold \(Family asked to wait\)/);
    expect(releaseGateRefusal(viewing(run('released', 'hold_placed', 'reauthorized')), true)).toBeNull();
  });
  it('Direct Cremation is never gated', () => {
    expect(releaseGateRefusal({ workflowSnapshot: { serviceTypeCode: SERVICE_TYPE_CODES.DIRECT_CREMATION } as Case['workflowSnapshot'], servicePreparation: null }, true)).toBeNull();
  });
});
