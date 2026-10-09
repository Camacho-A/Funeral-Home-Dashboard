import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Case } from '../types/case';
import { appointmentFixtures } from './__mocks__/schedulingFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { standardCremationWorkflowTemplateFixture } from './__mocks__/workflowTemplates';
import { buildCaseWorkflowSnapshot, latestTemplateVersion } from '../domain/workflow/snapshot';
import { checklistItemKey } from '../domain/workflow/checklistItemKey';
import {
  ORGANIZATION_DEFAULTS,
  MANORS_ORGANIZATION_ID,
  resolveCremainsPickupSettings,
} from '../domain/organization/cremainsPickupCapability';
import {
  allDayWindowFor,
  expectedDateOf,
  expectedPickupAppointmentId,
  isManuallyDecided,
  isPaperworkComplete,
  isReceiptItemChecked,
  listExpectedPickups,
  listOutstandingPickups,
  resolvePickupStatus,
  syncExpectedPickupForCase,
} from './cremainsPickupService';

/**
 * Expected Cremains Pickup — scheduling, idempotency, override and receipt
 * behavior. Driven through the real service against the real Manors
 * workflow shape, not a stand-in template.
 */

const MANORS_SETTINGS = ORGANIZATION_DEFAULTS[MANORS_ORGANIZATION_ID];
const ORGANIZATION = { id: MANORS_ORGANIZATION_ID, timezone: 'America/New_York' };

/** Thursday 2026-10-08, 14:00 Eastern. Confirmed rule -> Friday 2026-10-16. */
const PAPERWORK_AT = '2026-10-08T18:00:00.000Z';
const EXPECTED = '2026-10-16';

function ctx() {
  return {
    organizationId: MANORS_ORGANIZATION_ID,
    actorIdentityId: 'identity-dana',
    actorMembershipId: null,
    actorRoleKey: 'administrator',
    correlationId: 'correlation-cremains',
  };
}

const PAPERWORK_STAGE = MANORS_SETTINGS.paperworkStage.displayStage;
const RECEIPT = MANORS_SETTINGS.receiptChecklistItem;

function paperworkComplete(): Record<string, boolean> {
  return {
    [checklistItemKey(PAPERWORK_STAGE, 0)]: true,
    [checklistItemKey(PAPERWORK_STAGE, 1)]: true,
  };
}

function buildCase(overrides: Partial<Case> = {}): Case {
  const template = standardCremationWorkflowTemplateFixture;
  const version = latestTemplateVersion(template);
  return {
    id: 'case-cremains-1',
    organizationId: MANORS_ORGANIZATION_ID,
    caseNumber: 'B2026-040',
    decedentName: 'WALTER BOONE',
    dateOfBirth: '06/22/1945',
    dateOfDeath: '10/01/2026',
    timeOfDeath: '14:05',
    placeOfDeath: 'Riverside Nursing Facility',
    weight: '165 lb',
    rawStage: 4,
    assignedStaffId: null,
    nextOfKinName: 'Diane Boone',
    nextOfKinPhone: '(555) 442-0093',
    nextOfKinEmail: null,
    nextOfKinRelationship: null,
    nextOfKinRelationshipOther: null,
    certifierName: null,
    certifierPhone: null,
    certifierLicenseNumber: null,
    certifierFax: null,
    tagNumber: null,
    paymentStatus: 'awaiting_payment',
    pickupStatus: 'awaiting_pickup',
    pickupReleasedTo: null,
    pickupReleasedAt: null,
    pickupNote: null,
    returnMethod: 'undecided',
    shippingCarrier: null,
    shippingTrackingNumber: null,
    shippingDateShipped: null,
    shippingDeliveryStatus: null,
    shippingDeliveredAt: null,
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    vaNotificationResponsibility: null,
    checklistState: {},
    fieldValues: {},
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    createdBy: null,
    intakeOwnerId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    isDeleted: false,
    workflowTemplateId: template.id,
    workflowTemplateVersion: version.version,
    caseType: 'cremation',
    workflowSnapshot: buildCaseWorkflowSnapshot(template, version),
    ...overrides,
  };
}

let appointmentsBefore: number;
beforeEach(() => {
  appointmentsBefore = appointmentFixtures.length;
});
afterEach(() => {
  appointmentFixtures.length = appointmentsBefore;
});

describe('trigger identification — the paperwork TASK, never the stage', () => {
  it('the configured stage really is the crematory-paperwork stage in the live template shape', () => {
    const case_ = buildCase();
    const stage = case_.workflowSnapshot!.stages.find((s) => s.displayStage === PAPERWORK_STAGE)!;
    expect(stage.label).toBe(MANORS_SETTINGS.paperworkStage.expectedLabel);
    expect(stage.checklist.items.map((i) => i.label)).toEqual([
      'Permit sent to crematory',
      'Authorization of release sent to crematory',
    ]);
  });

  it('is NOT complete merely because the case sits in that stage', () => {
    expect(isPaperworkComplete(buildCase({ rawStage: 4, checklistState: {} }), MANORS_SETTINGS)).toBe(false);
  });

  it('is NOT complete when only one of the two paperwork items is checked', () => {
    const partial = { [checklistItemKey(PAPERWORK_STAGE, 0)]: true };
    expect(isPaperworkComplete(buildCase({ checklistState: partial }), MANORS_SETTINGS)).toBe(false);
  });

  it('IS complete when every item in the stage is checked', () => {
    expect(isPaperworkComplete(buildCase({ checklistState: paperworkComplete() }), MANORS_SETTINGS)).toBe(true);
  });

  it('refuses to fire when the template no longer matches the configured shape', () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    const snapshot = structuredClone(case_.workflowSnapshot!);
    snapshot.stages.find((s) => s.displayStage === PAPERWORK_STAGE)!.label = 'Something Else Entirely';
    expect(isPaperworkComplete({ ...case_, workflowSnapshot: snapshot }, MANORS_SETTINGS)).toBe(false);
  });

  it('the receipt item is the organization\'s existing "Ashes picked up" checklist item', () => {
    const case_ = buildCase();
    const stage = case_.workflowSnapshot!.stages.find((s) => s.displayStage === RECEIPT.displayStage)!;
    expect(stage.checklist.items[RECEIPT.index].label).toBe('Ashes picked up (Tue/Fri)');
    expect(isReceiptItemChecked(case_, MANORS_SETTINGS)).toBe(false);
    const checked = buildCase({ checklistState: { [checklistItemKey(RECEIPT.displayStage, RECEIPT.index)]: true } });
    expect(isReceiptItemChecked(checked, MANORS_SETTINGS)).toBe(true);
  });
});

describe('syncExpectedPickupForCase — creation', () => {
  it('completing the paperwork creates exactly one ESTIMATED pickup on the calculated date', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    const outcome = await syncExpectedPickupForCase(
      { case_, organization: ORGANIZATION, paperworkCompletedAt: PAPERWORK_AT },
      ctx(),
      'mock',
    );

    expect(outcome.action).toBe('created');
    const appointment = outcome.appointment!;
    expect(expectedDateOf(appointment)).toBe(EXPECTED);
    expect(appointment.caseId).toBe(case_.id);
    expect(appointment.organizationId).toBe(MANORS_ORGANIZATION_ID);
    expect(appointment.appointmentType).toBe('cremains.pickup.expected');
    // ESTIMATED — a real scheduled event, not a draft awaiting resources.
    expect(appointment.status).toBe('scheduled');
    expect(resolvePickupStatus(appointment, '2026-10-09')).toBe('estimated');
    expect(appointmentFixtures.length).toBe(appointmentsBefore + 1);
  });

  it('uses the stable case-scoped identity', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    const outcome = await syncExpectedPickupForCase(
      { case_, organization: ORGANIZATION, paperworkCompletedAt: PAPERWORK_AT },
      ctx(),
      'mock',
    );
    expect(outcome.appointment!.id).toBe(expectedPickupAppointmentId(case_.id));
  });

  it('records that it was generated automatically, not by the staff member who ticked the box', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    const outcome = await syncExpectedPickupForCase(
      { case_, organization: ORGANIZATION, paperworkCompletedAt: PAPERWORK_AT },
      ctx(),
      'mock',
    );
    // The scheduling service normalizes notes to uppercase; assert on the
    // meaning rather than the casing it happens to store.
    expect(outcome.appointment!.notes?.toLowerCase()).toContain('automatically scheduled');
    expect(outcome.appointment!.notes).toContain('2026-10-08');
    expect(isManuallyDecided(outcome.appointment!)).toBe(false);
  });

  it('an incomplete paperwork stage creates nothing at all', async () => {
    const outcome = await syncExpectedPickupForCase(
      { case_: buildCase(), organization: ORGANIZATION, paperworkCompletedAt: PAPERWORK_AT },
      ctx(),
      'mock',
    );
    expect(outcome.action).toBe('unchanged');
    expect(appointmentFixtures.length).toBe(appointmentsBefore);
  });

  it('an unrelated checklist item creates nothing', async () => {
    // A completed item in a DIFFERENT stage must not trigger scheduling.
    const unrelated = { [checklistItemKey(2, 0)]: true, [checklistItemKey(4, 0)]: true };
    const outcome = await syncExpectedPickupForCase(
      { case_: buildCase({ checklistState: unrelated }), organization: ORGANIZATION, paperworkCompletedAt: PAPERWORK_AT },
      ctx(),
      'mock',
    );
    expect(outcome.action).toBe('unchanged');
    expect(appointmentFixtures.length).toBe(appointmentsBefore);
  });
});

describe('syncExpectedPickupForCase — idempotency', () => {
  async function sync(case_: Case, at = PAPERWORK_AT) {
    return syncExpectedPickupForCase({ case_, organization: ORGANIZATION, paperworkCompletedAt: at }, ctx(), 'mock');
  }

  it('repeated saves never create a duplicate', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    const first = await sync(case_);
    const second = await sync(case_);
    const third = await sync(case_);

    expect(first.action).toBe('created');
    expect(second.action).toBe('unchanged');
    expect(third.action).toBe('unchanged');
    expect(appointmentFixtures.filter((a) => a.caseId === case_.id)).toHaveLength(1);
    expect(appointmentFixtures.length).toBe(appointmentsBefore + 1);
  });

  it('concurrent syncs resolve to one event, because the identity is deterministic', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await Promise.all([sync(case_), sync(case_), sync(case_), sync(case_)]);
    expect(appointmentFixtures.filter((a) => a.caseId === case_.id)).toHaveLength(1);
  });

  it('a later paperwork instant that yields the SAME date changes nothing', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await sync(case_);
    // Friday 2026-10-09 also maps to Friday 2026-10-16.
    const again = await sync(case_, '2026-10-09T18:00:00.000Z');
    expect(again.action).toBe('unchanged');
    expect(expectedDateOf(again.appointment!)).toBe(EXPECTED);
  });

  it('recalculates an untouched automatic pickup when the paperwork date genuinely changes', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await sync(case_);
    // Monday 2026-10-05 -> Tuesday 2026-10-13.
    const updated = await sync(case_, '2026-10-05T18:00:00.000Z');
    expect(updated.action).toBe('updated');
    expect(expectedDateOf(updated.appointment!)).toBe('2026-10-13');
    expect(appointmentFixtures.filter((a) => a.caseId === case_.id)).toHaveLength(1);
  });
});

describe('syncExpectedPickupForCase — manual overrides win', () => {
  async function sync(case_: Case, at = PAPERWORK_AT) {
    return syncExpectedPickupForCase({ case_, organization: ORGANIZATION, paperworkCompletedAt: at }, ctx(), 'mock');
  }

  it('a staff-edited date is never overwritten by recalculation', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await sync(case_);

    // Staff move it to Tuesday 2026-10-13 — the crematory called. Anchored
    // at the ORGANIZATION's midnight, exactly as the service stores it.
    const row = appointmentFixtures.find((a) => a.id === expectedPickupAppointmentId(case_.id))!;
    const moved = allDayWindowFor('2026-10-13', ORGANIZATION.timezone);
    row.startAt = moved.startAt;
    row.endAt = moved.endAt;
    row.lastModifiedBy = 'identity-dana';

    const again = await sync(case_, '2026-10-05T18:00:00.000Z');
    expect(again.action).toBe('unchanged');
    expect(expectedDateOf(again.appointment!)).toBe('2026-10-13');
  });

  it('a CONFIRMED date is never silently overwritten, even by a genuinely different calculation', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await sync(case_);
    const row = appointmentFixtures.find((a) => a.id === expectedPickupAppointmentId(case_.id))!;
    row.status = 'confirmed';

    const again = await sync(case_, '2026-10-05T18:00:00.000Z');
    expect(again.action).toBe('unchanged');
    expect(expectedDateOf(again.appointment!)).toBe(EXPECTED);
    expect(again.appointment!.status).toBe('confirmed');
  });

  it('unchecking the paperwork task preserves the pickup rather than deleting it', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await sync(case_);

    const unchecked = buildCase({ checklistState: { [checklistItemKey(PAPERWORK_STAGE, 0)]: true } });
    const outcome = await sync(unchecked);

    expect(outcome.action).toBe('unchanged');
    expect(outcome.appointment).not.toBeNull();
    expect(appointmentFixtures.filter((a) => a.caseId === case_.id)).toHaveLength(1);
  });

  it('re-checking after an uncheck does not duplicate and does not overwrite a confirmed date', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await sync(case_);
    const row = appointmentFixtures.find((a) => a.id === expectedPickupAppointmentId(case_.id))!;
    row.status = 'confirmed';

    await sync(buildCase({ checklistState: {} }));
    const recheck = await sync(case_, '2026-10-05T18:00:00.000Z');

    expect(recheck.action).toBe('unchanged');
    expect(recheck.appointment!.status).toBe('confirmed');
    expect(appointmentFixtures.filter((a) => a.caseId === case_.id)).toHaveLength(1);
  });
});

describe('receipt', () => {
  async function sync(case_: Case) {
    return syncExpectedPickupForCase({ case_, organization: ORGANIZATION, paperworkCompletedAt: PAPERWORK_AT }, ctx(), 'mock');
  }

  function receivedCase(): Case {
    return buildCase({
      checklistState: {
        ...paperworkComplete(),
        [checklistItemKey(RECEIPT.displayStage, RECEIPT.index)]: true,
      },
    });
  }

  it('checking the existing receipt item marks the pickup RECEIVED', async () => {
    await sync(buildCase({ checklistState: paperworkComplete() }));
    const outcome = await sync(receivedCase());

    expect(outcome.action).toBe('received');
    expect(outcome.appointment!.status).toBe('completed');
    expect(resolvePickupStatus(outcome.appointment!, '2026-10-20')).toBe('received');
  });

  it('receipt preserves the event — it is never deleted', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await sync(case_);
    await sync(receivedCase());
    expect(appointmentFixtures.filter((a) => a.id === expectedPickupAppointmentId(case_.id))).toHaveLength(1);
  });

  it('a received pickup leaves the outstanding list but stays in history', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await sync(case_);
    expect((await listOutstandingPickups(MANORS_ORGANIZATION_ID, '2026-10-09', 'mock')).map((p) => p.appointment.caseId)).toContain(case_.id);

    await sync(receivedCase());
    expect((await listOutstandingPickups(MANORS_ORGANIZATION_ID, '2026-10-09', 'mock')).map((p) => p.appointment.caseId)).not.toContain(case_.id);
    expect((await listExpectedPickups(MANORS_ORGANIZATION_ID, {}, 'mock')).map((p) => p.caseId)).toContain(case_.id);
  });

  it('receipt is terminal — a later sync never reopens or re-dates it', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await sync(case_);
    await sync(receivedCase());

    const again = await syncExpectedPickupForCase(
      { case_: buildCase({ checklistState: paperworkComplete() }), organization: ORGANIZATION, paperworkCompletedAt: '2026-10-05T18:00:00.000Z' },
      ctx(),
      'mock',
    );
    expect(again.action).toBe('unchanged');
    expect(again.appointment!.status).toBe('completed');
    expect(expectedDateOf(again.appointment!)).toBe(EXPECTED);
  });

  it('the arrival of the expected date alone never marks anything received', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await sync(case_);
    // "Today" is well past the expected date, and nothing was received.
    const outcome = await sync(case_);
    expect(outcome.appointment!.status).toBe('scheduled');
    expect(resolvePickupStatus(outcome.appointment!, '2026-11-01')).toBe('overdue');
  });

  it('an overdue pickup stays visible in the outstanding list', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await sync(case_);
    const outstanding = await listOutstandingPickups(MANORS_ORGANIZATION_ID, '2026-11-01', 'mock');
    const entry = outstanding.find((p) => p.appointment.caseId === case_.id);
    expect(entry?.status).toBe('overdue');
  });
});

describe('multi-tenant safety', () => {
  it('an unconfigured organization schedules nothing — existing behavior preserved', async () => {
    const gus = { id: SECOND_MOCK_ORGANIZATION_ID, timezone: 'America/New_York' };
    const case_ = buildCase({ organizationId: SECOND_MOCK_ORGANIZATION_ID, checklistState: paperworkComplete() });
    const outcome = await syncExpectedPickupForCase(
      { case_, organization: gus, paperworkCompletedAt: PAPERWORK_AT },
      { ...ctx(), organizationId: SECOND_MOCK_ORGANIZATION_ID },
      'mock',
    );
    expect(outcome.action).toBe('unchanged');
    expect(appointmentFixtures.length).toBe(appointmentsBefore);
  });

  it('Manors rules apply to Manors and are not imposed on anyone else', () => {
    expect(resolveCremainsPickupSettings({ id: MANORS_ORGANIZATION_ID }).automaticSchedulingEnabled).toBe(true);
    expect(resolveCremainsPickupSettings({ id: SECOND_MOCK_ORGANIZATION_ID }).automaticSchedulingEnabled).toBe(false);
    expect(resolveCremainsPickupSettings({ id: DEFAULT_ORGANIZATION_ID }).allowedPickupWeekdays).toEqual([2, 5]);
  });

  it('pickup listings never leak another organization\'s cases', async () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    await syncExpectedPickupForCase(
      { case_, organization: ORGANIZATION, paperworkCompletedAt: PAPERWORK_AT },
      ctx(),
      'mock',
    );
    const otherOrgView = await listExpectedPickups(SECOND_MOCK_ORGANIZATION_ID, {}, 'mock');
    expect(otherOrgView.map((a) => a.caseId)).not.toContain(case_.id);
    expect(otherOrgView.every((a) => a.organizationId === SECOND_MOCK_ORGANIZATION_ID)).toBe(true);
  });
});

/**
 * Trigger precision (2026-10). Narrowed from "every item in the stage" to
 * the specific configured paperwork items, so an unrelated item added to
 * that stage later can never delay a pickup.
 */
describe('trigger precision — only the configured paperwork items count', () => {
  it('fires on exactly the two configured crematory-paperwork items', () => {
    expect(MANORS_SETTINGS.paperworkStage.items.map((i) => i.expectedLabel)).toEqual([
      'Permit sent to crematory',
      'Authorization of release sent to crematory',
    ]);
    expect(isPaperworkComplete(buildCase({ checklistState: paperworkComplete() }), MANORS_SETTINGS)).toBe(true);
  });

  it('an UNRELATED item added to the same stage does not delay the pickup', () => {
    // The real risk the narrowing removes: a future third item in this
    // stage would previously have blocked every pickup until it was ticked.
    const case_ = buildCase({ checklistState: paperworkComplete() });
    const snapshot = structuredClone(case_.workflowSnapshot!);
    const stage = snapshot.stages.find((s) => s.displayStage === PAPERWORK_STAGE)!;
    stage.checklist.items.push({ label: 'Something unrelated', hasField: false, isPasswordField: false } as never);
    expect(isPaperworkComplete({ ...case_, workflowSnapshot: snapshot }, MANORS_SETTINGS)).toBe(true);
  });

  it('partial completion still does NOT fire — both paperwork items are required', () => {
    for (const partial of [
      { [checklistItemKey(PAPERWORK_STAGE, 0)]: true },
      { [checklistItemKey(PAPERWORK_STAGE, 1)]: true },
      {},
    ]) {
      expect(isPaperworkComplete(buildCase({ checklistState: partial }), MANORS_SETTINGS)).toBe(false);
    }
  });

  it('this is exactly why B2026-035 did not schedule: only item 1 is checked', () => {
    // The real production state, reproduced: "Authorization of release" is
    // true, "Permit sent to crematory" has never been checked.
    const b2026035 = buildCase({ checklistState: { '2:2': true, '4:0': true, '4:1': true, '0:10': true, '1:0': true, '0:8': true, '3:1': true } });
    expect(isPaperworkComplete(b2026035, MANORS_SETTINGS)).toBe(false);
  });

  it('a renamed paperwork item disables scheduling rather than firing off the wrong task', () => {
    const case_ = buildCase({ checklistState: paperworkComplete() });
    const snapshot = structuredClone(case_.workflowSnapshot!);
    snapshot.stages.find((s) => s.displayStage === PAPERWORK_STAGE)!.checklist.items[0].label = 'Renamed task';
    expect(isPaperworkComplete({ ...case_, workflowSnapshot: snapshot }, MANORS_SETTINGS)).toBe(false);
  });

  it('completing an item in a DIFFERENT stage never triggers scheduling', async () => {
    const unrelated = { [checklistItemKey(2, 0)]: true, [checklistItemKey(4, 0)]: true, [checklistItemKey(5, 1)]: true };
    const outcome = await syncExpectedPickupForCase(
      { case_: buildCase({ checklistState: unrelated }), organization: ORGANIZATION, paperworkCompletedAt: PAPERWORK_AT },
      ctx(),
      'mock',
    );
    expect(outcome.action).toBe('unchanged');
    expect(appointmentFixtures.length).toBe(appointmentsBefore);
  });
});

describe('organization timezone — Chicago vs New York', () => {
  it('the midnight-to-1am Eastern window resolves to a different calendar day under Chicago', async () => {
    // 2026-10-03T04:30Z is 00:30 Eastern on Oct 3, but 23:30 Central on
    // Oct 2 — a full day earlier, which lands on a different pickup.
    const at = '2026-10-03T04:30:00.000Z';
    const ny = await syncExpectedPickupForCase(
      { case_: buildCase({ checklistState: paperworkComplete() }), organization: { id: MANORS_ORGANIZATION_ID, timezone: 'America/New_York' }, paperworkCompletedAt: at },
      ctx(),
      'mock',
    );
    expect(expectedDateOf(ny.appointment!)).toBe('2026-10-13');

    appointmentFixtures.length = appointmentsBefore;
    const chi = await syncExpectedPickupForCase(
      { case_: buildCase({ checklistState: paperworkComplete() }), organization: { id: MANORS_ORGANIZATION_ID, timezone: 'America/Chicago' }, paperworkCompletedAt: at },
      ctx(),
      'mock',
    );
    expect(expectedDateOf(chi.appointment!)).toBe('2026-10-09');
  });

  it('the all-day anchor follows the organization timezone', async () => {
    const outcome = await syncExpectedPickupForCase(
      { case_: buildCase({ checklistState: paperworkComplete() }), organization: ORGANIZATION, paperworkCompletedAt: PAPERWORK_AT },
      ctx(),
      'mock',
    );
    // Eastern midnight on the expected date, not UTC midnight.
    expect(outcome.appointment!.startAt).toBe('2026-10-16T04:00:00.000Z');
    expect(outcome.appointment!.timezone).toBe('America/New_York');
  });
});
