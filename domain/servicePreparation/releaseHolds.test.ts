import { describe, expect, it } from 'vitest';
import { appendReleaseEvent, currentHold, isReleasedStatus, releaseEventsOf, releaseStatusOf, ReleaseTransitionError, RELEASE_EVENT_ALLOWED_FROM } from './releaseHolds';
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
    expect(Object.keys(RELEASE_EVENT_ALLOWED_FROM).sort()).toEqual(['hold_placed', 'reauthorization_requested', 'reauthorized', 'release_requested', 'released']);
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
