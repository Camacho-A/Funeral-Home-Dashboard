import { describe, expect, it } from 'vitest';
import { CREMATION_STEPS } from '../workflow/cremationFoundation';
import { buildServiceWorkflowTemplateDefinitions, SERVICE_TYPE_CODES } from '../workflow/serviceWorkflows';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID, getRegisteredOrganizationProfile } from '../organization/organizationProfiles';
import { isAppointmentTypeOffered, isValidAppointmentTypeKey } from '../scheduling/appointmentTypeRegistry';
import { buildGusCaseFixtures } from '../../services/__mocks__/gusFixtures';
import { evaluateDeadline, resolvePreparationTargets } from './deadlines';
import { applyPreparationChange, PreparationChangeError, PreparationConflictError, type PreparationChange } from './preparationUpdates';
import { readServicePreparationRecord } from './recordParsing';
import { selectServiceEvent, summarizeServiceReadiness } from './readiness';
import { evaluateReleaseForCremation, LEGAL_REQUIREMENTS_STILL_CHECKED } from './releaseForCremation';
import { FINAL_GOODBYE_PREPARATION, MASS_PREPARATION, PROVISIONAL_MASS_SERVICE_TYPE_CODE, SERVICE_PREPARATION_DEFINITIONS, VIEWING_PREPARATION, servicePreparationFor } from './serviceDefinitions';
import type { ServiceEvent, ServicePreparationDefinition, ServicePreparationRecord } from './types';

/** Service preparation (Gus Phase 5B). Fictional dates, ids and names only. */

const SERVICE_START = '2026-12-10T15:00:00.000Z';
const service = (overrides: Partial<ServiceEvent> = {}): ServiceEvent => ({
  appointmentId: 'appt-fictional-1',
  startAt: SERVICE_START,
  endAt: '2026-12-10T17:00:00.000Z',
  status: 'scheduled',
  bookedAt: '2026-12-01T12:00:00.000Z',
  ...overrides,
});
const hoursBefore = (iso: string, hours: number) => new Date(Date.parse(iso) - hours * 3_600_000).toISOString();
const actor = { id: 'identity-fictional', name: 'Fictional Director' };

function apply(definition: ServicePreparationDefinition, changes: PreparationChange[], svc: ServiceEvent | null = service(), start: ServicePreparationRecord | null = null) {
  return changes.reduce<ServicePreparationRecord | null>(
    (record, change) => applyPreparationChange({ definition, record, service: svc, change, actor, now: '2026-12-02T12:00:00.000Z' }),
    start,
  ) as ServicePreparationRecord;
}

const itemsOf = (definition: ServicePreparationDefinition, record: ServicePreparationRecord | null, svc: ServiceEvent | null = service(), now = '2026-12-02T12:00:00.000Z') =>
  summarizeServiceReadiness({ definition, record, service: svc, now });

describe('Direct Cremation and Manors stay unchanged', () => {
  it('Direct Cremation has no preparation', () => {
    expect(servicePreparationFor(SERVICE_TYPE_CODES.DIRECT_CREMATION)).toBeNull();
    expect(servicePreparationFor(null)).toBeNull();
  });

  it('the service workflow templates are still exactly the cremation foundation', () => {
    const templates = buildServiceWorkflowTemplateDefinitions({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, arrangementFormIntegrationId: null, intake: { fields: [] } as never, createdAt: '2026-11-01T00:00:00.000Z' });
    const stagesOf = (code: string) => templates.find((t) => t.serviceTypeCode === code)!.version.stages;
    expect(stagesOf(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING)).toEqual(stagesOf(SERVICE_TYPE_CODES.DIRECT_CREMATION));
    expect(stagesOf(SERVICE_TYPE_CODES.CREMATION_WITH_FINAL_GOODBYE)).toEqual(stagesOf(SERVICE_TYPE_CODES.DIRECT_CREMATION));
    expect(stagesOf(SERVICE_TYPE_CODES.DIRECT_CREMATION)).toHaveLength(8);
    expect(templates.map((t) => t.serviceTypeCode)).not.toContain(PROVISIONAL_MASS_SERVICE_TYPE_CODE);
  });

  it('service preparation is off for Manors and the platform default, on for Gus', () => {
    expect(getRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID).features.servicePreparation).toBe(false);
    expect(getRegisteredOrganizationProfile('some-new-organization').features.servicePreparation).toBe(false);
    expect(getRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID).features.servicePreparation).toBe(true);
  });

  it('Manors is never offered the Final Goodbye or Mass appointment types; existing types are unchanged', () => {
    const manors = getRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID).features;
    const gus = getRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID).features;
    for (const key of ['final.goodbye', 'funeral.mass']) {
      expect(isValidAppointmentTypeKey(key)).toBe(true);
      expect(isAppointmentTypeOffered(key, manors)).toBe(false);
      expect(isAppointmentTypeOffered(key, gus)).toBe(true);
    }
    for (const key of ['viewing', 'family.meeting', 'cremains.pickup.expected']) expect(isAppointmentTypeOffered(key, manors)).toBe(true);
    expect(isAppointmentTypeOffered('not.a.type', gus)).toBe(false);
  });
});

describe('preparation is separate from the cremation steps', () => {
  it('no preparation id is a workflow or legal step, and ids are unique per service', () => {
    const cremationStepIds = new Set<string>(Object.values(CREMATION_STEPS));
    for (const definition of SERVICE_PREPARATION_DEFINITIONS) {
      const ids = definition.groups.flatMap((g) => g.items.map((i) => i.id));
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id.startsWith('prep.')).toBe(true);
        expect(cremationStepIds.has(id)).toBe(false);
      }
      expect(definition.status).toBe('draft');
    }
  });

  it('a change naming a cremation step is refused', () => {
    expect(() => apply(VIEWING_PREPARATION, [{ kind: 'item', itemId: CREMATION_STEPS.authorizationSent, status: 'completed' }])).toThrow(PreparationChangeError);
    expect(() => apply(VIEWING_PREPARATION, [{ kind: 'item', itemId: CREMATION_STEPS.permitSent, status: 'completed' }])).toThrow(PreparationChangeError);
  });

  it('preparation can be worked on a case that has not reached EDRS', () => {
    const viewingCase = buildGusCaseFixtures(new Date('2026-12-01T12:00:00.000Z')).find((c) => c.workflowSnapshot?.serviceTypeCode === SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING)!;
    expect(viewingCase.rawStage).toBeLessThan(3); // before EDRS
    const definition = servicePreparationFor(viewingCase.workflowSnapshot?.serviceTypeCode)!;
    const record = apply(definition, [
      { kind: 'choice', choice: 'casket', value: 'rental' },
      { kind: 'item', itemId: 'prep.casket.ordered', status: 'completed' },
    ]);
    expect(itemsOf(definition, record).items.find((i) => i.id === 'prep.casket.ordered')!.done).toBe(true);
  });

  it('even with every requirement met and an authorized approver, release stays disabled', () => {
    const svc = service({ status: 'completed' });
    const record = apply(
      VIEWING_PREPARATION,
      [
        { kind: 'item', itemId: 'prep.crematory.notified', status: 'completed' },
        { kind: 'item', itemId: 'prep.crematory.hold_confirmed', status: 'confirmed' },
      ],
      svc,
    );
    const release = evaluateReleaseForCremation({ readiness: itemsOf(VIEWING_PREPARATION, record, svc), record, actorMayRelease: true });
    expect(release.requirements.every((r) => r.met)).toBe(true);
    expect(release.canRelease).toBe(false);
    expect(release.unavailableReason).toMatch(/licensed funeral directors/);
    expect(LEGAL_REQUIREMENTS_STILL_CHECKED).toContain('Burial-transit permit');
  });

  it('staff who may not release never meet the approver requirement', () => {
    const release = evaluateReleaseForCremation({ readiness: itemsOf(VIEWING_PREPARATION, null), record: null, actorMayRelease: false });
    expect(release.requirements.find((r) => r.key === 'authorized_approver')!.met).toBe(false);
    expect(release.canRelease).toBe(false);
  });
});

describe('optional and conditional items', () => {
  it('an optional group is a decision until the family answers', () => {
    const readiness = itemsOf(VIEWING_PREPARATION, null);
    expect(readiness.decisions.map((d) => d.choice)).toContain('prayerCards');
    const printed = readiness.items.find((i) => i.id === 'prep.prayer_cards.printed')!;
    expect(printed.status).toBe('pending');
    expect(printed.blocking).toBe(true);
    expect(readiness.ready).toBe(false);
  });

  it('Not requested neither blocks nor counts as done', () => {
    const record = apply(VIEWING_PREPARATION, [{ kind: 'choice', choice: 'prayerCards', value: 'not_requested' }]);
    const readiness = itemsOf(VIEWING_PREPARATION, record);
    for (const id of ['prep.prayer_cards.proof_approved', 'prep.prayer_cards.printed']) {
      const item = readiness.items.find((i) => i.id === id)!;
      expect(item.status).toBe('not_requested');
      expect(item.done).toBe(false);
      expect(item.blocking).toBe(false);
      expect(item.deadline).toBeNull();
    }
    expect(readiness.decisions.map((d) => d.choice)).not.toContain('prayerCards');
  });

  it('a required item cannot be marked Not requested', () => {
    expect(() => apply(VIEWING_PREPARATION, [{ kind: 'item', itemId: 'prep.crematory.notified', status: 'not_requested' }])).toThrow(/required/);
    const stored: ServicePreparationRecord = {
      ...apply(VIEWING_PREPARATION, []),
      items: { 'prep.crematory.notified': { status: 'not_requested', at: '2026-12-02T12:00:00.000Z', by: null } },
    };
    expect(itemsOf(VIEWING_PREPARATION, stored).items.find((i) => i.id === 'prep.crematory.notified')!.status).toBe('pending');
  });

  it('a Final Goodbye assumes neither embalming nor a casket', () => {
    const none = itemsOf(FINAL_GOODBYE_PREPARATION, null).items.map((i) => i.id);
    expect(none.some((id) => id.startsWith('prep.embalming.') || id.startsWith('prep.casket.'))).toBe(false);
    const record = apply(FINAL_GOODBYE_PREPARATION, [
      { kind: 'choice', choice: 'embalming', value: 'embalmed' },
      { kind: 'choice', choice: 'casket', value: 'none' },
    ]);
    const ids = itemsOf(FINAL_GOODBYE_PREPARATION, record).items.map((i) => i.id);
    expect(ids).toContain('prep.embalming.written_permission');
    expect(ids.some((id) => id.startsWith('prep.casket.'))).toBe(false);
  });

  it('a Mass does not assume the body is present', () => {
    const undecided = itemsOf(MASS_PREPARATION, null);
    expect(undecided.holdsCremation).toBe('undecided');
    expect(undecided.items.some((i) => i.groupKey === 'crematory_hold')).toBe(false);
    const memorial = itemsOf(MASS_PREPARATION, apply(MASS_PREPARATION, [{ kind: 'choice', choice: 'massPresence', value: 'cremated_remains' }]));
    expect(memorial.holdsCremation).toBe(false);
    expect(memorial.items.some((i) => i.groupKey === 'crematory_hold')).toBe(false);
    const bodyPresent = itemsOf(MASS_PREPARATION, apply(MASS_PREPARATION, [{ kind: 'choice', choice: 'massPresence', value: 'body_present' }]));
    expect(bodyPresent.holdsCremation).toBe(true);
    expect(bodyPresent.items.map((i) => i.id)).toContain('prep.crematory.hold_confirmed');
  });

  it('unknown choices, answers and details are refused', () => {
    expect(() => apply(VIEWING_PREPARATION, [{ kind: 'choice', choice: 'casket', value: 'gold' }])).toThrow(PreparationChangeError);
    expect(() => apply(VIEWING_PREPARATION, [{ kind: 'detail', key: 'prayerCards.language', value: 'klingon' }])).toThrow(PreparationChangeError);
    expect(apply(VIEWING_PREPARATION, [{ kind: 'detail', key: 'prayerCards.language', value: 'spanish' }]).details['prayerCards.language'].value).toBe('spanish');
  });
});

describe('deadlines', () => {
  const at = (hours: number, bookedHoursBefore = 240) =>
    evaluateDeadline({ target: 'casket_order', serviceStartAt: SERVICE_START, bookedAt: hoursBefore(SERVICE_START, bookedHoursBefore), now: hoursBefore(SERVICE_START, hours) });

  it('72–48 hours: upcoming, due, overdue, urgent inside the last day', () => {
    expect(at(100).state).toBe('upcoming');
    expect(at(60).state).toBe('due');
    expect(at(40).state).toBe('overdue');
    expect(at(40).urgent).toBe(false);
    expect(at(12).urgent).toBe(true);
    expect(at(100).dueAt).toBe(hoursBefore(SERVICE_START, 48));
  });

  it('a service booked after the target is due now — short notice, flagged for review', () => {
    const shortNotice = at(30, 36);
    expect(shortNotice.state).toBe('short_notice');
    expect(shortNotice.needsReview).toBe(true);
  });

  it('targets are configurable, and a window that closes before it opens is refused', () => {
    expect(resolvePreparationTargets({ casket_order: { earliestHoursBefore: 96 } }).casket_order.earliestHoursBefore).toBe(96);
    expect(() => resolvePreparationTargets({ casket_order: { earliestHoursBefore: 10, latestHoursBefore: 20 } })).toThrow();
  });

  it('a reschedule moves every deadline, with nothing stored to rewrite', () => {
    const before = itemsOf(VIEWING_PREPARATION, null).items.find((i) => i.id === 'prep.crematory.notified')!;
    const later = '2026-12-12T15:00:00.000Z';
    const after = itemsOf(VIEWING_PREPARATION, null, service({ startAt: later, endAt: '2026-12-12T17:00:00.000Z' })).items.find((i) => i.id === 'prep.crematory.notified')!;
    expect(before.deadline!.dueAt).toBe(hoursBefore(SERVICE_START, 48));
    expect(after.deadline!.dueAt).toBe(hoursBefore(later, 48));
  });
});

describe('rescheduling', () => {
  const original = service();
  const moved = service({ startAt: '2026-12-11T15:00:00.000Z', endAt: '2026-12-11T17:00:00.000Z' });
  const record = apply(VIEWING_PREPARATION, [
    { kind: 'item', itemId: 'prep.crematory.hold_confirmed', status: 'confirmed' },
    { kind: 'choice', choice: 'clothing', value: 'family_provides' },
    { kind: 'item', itemId: 'prep.clothing.received', status: 'completed' },
  ], original);

  it('date-dependent confirmations must be confirmed again; other work stays done', () => {
    const items = itemsOf(VIEWING_PREPARATION, record, moved).items;
    const hold = items.find((i) => i.id === 'prep.crematory.hold_confirmed')!;
    expect(hold.status).toBe('needs_reconfirmation');
    expect(hold.done).toBe(false);
    expect(hold.record!.status).toBe('confirmed'); // the earlier confirmation is kept
    expect(items.find((i) => i.id === 'prep.clothing.received')!.done).toBe(true);
    expect(itemsOf(VIEWING_PREPARATION, record, moved).counts.needsReconfirmation).toBe(1);
  });

  it('confirming again for the new date clears it, without adding a second item', () => {
    const reconfirmed = apply(VIEWING_PREPARATION, [{ kind: 'item', itemId: 'prep.crematory.hold_confirmed', status: 'confirmed' }], moved, record);
    const readiness = itemsOf(VIEWING_PREPARATION, reconfirmed, moved);
    expect(readiness.items.find((i) => i.id === 'prep.crematory.hold_confirmed')!.done).toBe(true);
    expect(readiness.items.filter((i) => i.id === 'prep.crematory.hold_confirmed')).toHaveLength(1);
    expect(readiness.items.length).toBe(itemsOf(VIEWING_PREPARATION, record, moved).items.length);
    expect(Object.keys(reconfirmed.items).sort()).toEqual(Object.keys(record.items).sort());
  });

  it('a date-dependent confirmation needs a scheduled service', () => {
    expect(() => apply(VIEWING_PREPARATION, [{ kind: 'item', itemId: 'prep.crematory.hold_confirmed', status: 'confirmed' }], null)).toThrow(/Schedule the viewing first/);
  });
});

describe('organization isolation', () => {
  const appt = (overrides: Record<string, unknown>) => ({
    id: 'a1',
    organizationId: GUS_CAMACHO_ORGANIZATION_ID,
    caseId: 'case-fictional',
    appointmentType: 'viewing',
    startAt: SERVICE_START,
    endAt: '2026-12-10T17:00:00.000Z',
    status: 'scheduled' as ServiceEvent['status'],
    createdAt: '2026-12-01T12:00:00.000Z',
    ...overrides,
  });
  const params = { organizationId: GUS_CAMACHO_ORGANIZATION_ID, caseId: 'case-fictional', appointmentType: 'viewing' };

  it("never picks another organization's or case's appointment, or a cancelled one", () => {
    expect(selectServiceEvent([appt({ organizationId: MANORS_ORGANIZATION_ID })], params)).toBeNull();
    expect(selectServiceEvent([appt({ caseId: 'other-case' })], params)).toBeNull();
    expect(selectServiceEvent([appt({ status: 'cancelled' })], params)).toBeNull();
    expect(selectServiceEvent([appt({ appointmentType: 'family.meeting' })], params)).toBeNull();
    expect(selectServiceEvent([appt({})], params)?.appointmentId).toBe('a1');
  });

  it('an upcoming service wins over a completed one', () => {
    const chosen = selectServiceEvent([appt({ id: 'done', status: 'completed', startAt: '2026-12-01T15:00:00.000Z' }), appt({ id: 'next' })], params);
    expect(chosen?.appointmentId).toBe('next');
  });

  it("a record made for another service's preparation is ignored, and cannot be changed through it", () => {
    const viewingRecord = apply(VIEWING_PREPARATION, [{ kind: 'choice', choice: 'casket', value: 'rental' }]);
    expect(itemsOf(FINAL_GOODBYE_PREPARATION, viewingRecord).items.every((i) => i.record === null)).toBe(true);
    expect(() => apply(FINAL_GOODBYE_PREPARATION, [{ kind: 'choice', choice: 'casket', value: 'rental' }], service(), viewingRecord)).toThrow(/different service/);
  });
});

describe('saving (Phase 5C)', () => {
  it('records who set a choice or detail, and when', () => {
    const record = apply(VIEWING_PREPARATION, [{ kind: 'choice', choice: 'casket', value: 'rental' }]);
    expect(record.choices.casket).toEqual({ value: 'rental', at: '2026-12-02T12:00:00.000Z', by: actor.id, byName: actor.name });
  });

  it('a status change keeps the note and linked document', () => {
    const first = apply(VIEWING_PREPARATION, [{ kind: 'item', itemId: 'prep.crematory.notified', status: 'pending', note: 'Called the front desk', documentId: 'doc-1' }]);
    const next = apply(VIEWING_PREPARATION, [{ kind: 'item', itemId: 'prep.crematory.notified', status: 'completed' }], service(), first);
    expect(next.items['prep.crematory.notified']).toMatchObject({ status: 'completed', note: 'Called the front desk', documentId: 'doc-1' });
    const cleared = apply(VIEWING_PREPARATION, [{ kind: 'item', itemId: 'prep.crematory.notified', status: 'completed', note: '  ', documentId: null }], service(), next);
    expect(cleared.items['prep.crematory.notified']).toMatchObject({ note: null, documentId: null });
  });

  it('refuses a change to an entry someone else changed since; other entries are unaffected', () => {
    const base = apply(VIEWING_PREPARATION, [{ kind: 'choice', choice: 'casket', value: 'rental' }]);
    const change: PreparationChange = { kind: 'choice', choice: 'casket', value: 'purchase' };
    const run = (basisAt: string | null) =>
      applyPreparationChange({ definition: VIEWING_PREPARATION, record: base, service: service(), change, basis: { at: basisAt }, actor, now: '2026-12-03T12:00:00.000Z' });
    expect(() => run(null)).toThrow(PreparationConflictError);
    expect(run(base.choices.casket.at).choices.casket.value).toBe('purchase');
    const other = applyPreparationChange({ definition: VIEWING_PREPARATION, record: base, service: service(), change: { kind: 'choice', choice: 'clothing', value: 'none' }, basis: { at: null }, actor, now: '2026-12-03T12:00:00.000Z' });
    expect(other.choices.casket.value).toBe('rental');
  });

  it('reads a stored record leniently: absent or malformed is no record, bad entries are dropped', () => {
    expect(readServicePreparationRecord(undefined)).toBeNull();
    expect(readServicePreparationRecord('nope')).toBeNull();
    expect(readServicePreparationRecord({ definitionKey: 'prep.viewing' })).toBeNull();
    const record = apply(VIEWING_PREPARATION, [
      { kind: 'choice', choice: 'casket', value: 'rental' },
      { kind: 'item', itemId: 'prep.crematory.notified', status: 'completed' },
    ]);
    const stored = JSON.parse(JSON.stringify(record));
    expect(readServicePreparationRecord(stored)).toEqual(record);
    stored.items['prep.bad'] = { status: 'done-ish', at: 'x' };
    stored.choices.bad = { value: 3 };
    const read = readServicePreparationRecord(stored)!;
    expect(read.items['prep.bad']).toBeUndefined();
    expect(read.choices.bad).toBeUndefined();
    expect(read.items['prep.crematory.notified'].status).toBe('completed');
  });
});
