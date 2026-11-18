import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';
import { appointmentFixtures } from './__mocks__/schedulingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { caseDocumentFixtures } from './__mocks__/documentFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { GUS_CAMACHO_ORGANIZATION_ID } from '../domain/organization/organizationProfiles';
import { summarizeServiceReadiness } from '../domain/servicePreparation/readiness';
import { VIEWING_PREPARATION } from '../domain/servicePreparation/serviceDefinitions';
import { ACTIVITY_EVENT_TYPES } from '../types/activityEvent';
import type { Appointment } from '../types/appointment';
import type { CaseDocument } from '../types/caseDocument';
import type { ActivityContext } from './activityService';

const wixDataApi = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../lib/wixDataApi', async () => {
  const actual = await vi.importActual<object>('../lib/wixDataApi');
  const count = () => {
    wixDataApi.calls += 1;
    throw new Error('Wix must not be called in this test');
  };
  return { ...actual, queryWixDataItems: count, conditionalPatchWixDataItemFields: count, queryAllWixDataItems: count };
});

const activityFailure = vi.hoisted(() => ({ fail: false }));
vi.mock('./activityService', async () => {
  const actual = await vi.importActual<typeof import('./activityService')>('./activityService');
  return {
    ...actual,
    recordServicePreparationChange: vi.fn(async (...args: Parameters<typeof actual.recordServicePreparationChange>) => {
      if (activityFailure.fail) throw new Error('Activity store unavailable (fictional)');
      return actual.recordServicePreparationChange(...args);
    }),
  };
});

const { changeServicePreparation, getServicePreparation, SERVICE_PREPARATION_STORAGE_UNAVAILABLE } = await import('./servicePreparationService');

/** Service preparation storage (Gus Phase 5C). Mock data mode, fictional cases only. */

const GUS = GUS_CAMACHO_ORGANIZATION_ID;
const VIEWING_CASE = 'gus-case-010';
const FINAL_GOODBYE_CASE = 'gus-case-011';
const DIRECT_CASE = 'gus-case-001';

const ctx = (overrides: Partial<ActivityContext> = {}): ActivityContext => ({
  organizationId: GUS,
  actorIdentityId: 'identity-gus-director',
  actorMembershipId: null,
  actorRoleKey: 'manager',
  correlationId: 'corr-fictional',
  ...overrides,
});

function viewing(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-viewing',
    organizationId: GUS,
    caseId: VIEWING_CASE,
    appointmentType: 'viewing',
    title: 'Viewing',
    notes: null,
    locationId: null,
    status: 'scheduled',
    startAt: '2026-12-10T15:00:00.000Z',
    endAt: '2026-12-10T17:00:00.000Z',
    timezone: 'America/New_York',
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: null,
    createdBy: 'identity-gus-director',
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: 'corr-fictional',
    createdAt: '2026-12-01T12:00:00.000Z',
    updatedAt: '2026-12-01T12:00:00.000Z',
    ...overrides,
  };
}

const originals = new Map(caseFixtures.map((c, i) => [i, c]));
beforeEach(() => {
  appointmentFixtures.length = 0;
  caseDocumentFixtures.length = 0;
  activityEventFixtures.length = 0;
  wixDataApi.calls = 0;
  activityFailure.fail = false;
});
afterEach(() => {
  for (const [i, c] of originals) caseFixtures[i] = c;
});

const save = (change: Parameters<typeof changeServicePreparation>[2]['change'], basisAt: string | null = null, caseId = VIEWING_CASE, context = ctx(), now = '2026-12-02T12:00:00.000Z') =>
  changeServicePreparation(context, caseId, { change, basis: { at: basisAt }, actorName: 'Jordan Demo', now }, 'mock');

describe('save and reload', () => {
  it('an existing case without preparation reads as empty, then shows what was saved', async () => {
    appointmentFixtures.push(viewing());
    const before = await getServicePreparation(GUS, VIEWING_CASE, 'mock');
    expect(before).toMatchObject({ applies: true, record: null, storageAvailable: true, isArchived: false });
    expect(before?.service?.appointmentId).toBe('appt-viewing');

    await save({ kind: 'choice', choice: 'casket', value: 'rental' });
    await save({ kind: 'item', itemId: 'prep.casket.ordered', status: 'completed', note: 'Order #FICT-1' });
    await save({ kind: 'detail', key: 'prayerCards.language', value: 'spanish' });

    const after = (await getServicePreparation(GUS, VIEWING_CASE, 'mock'))!;
    expect(after.record?.choices.casket).toMatchObject({ value: 'rental', by: 'identity-gus-director', byName: 'Jordan Demo', at: '2026-12-02T12:00:00.000Z' });
    expect(after.record?.items['prep.casket.ordered']).toMatchObject({ status: 'completed', note: 'Order #FICT-1', byName: 'Jordan Demo' });
    expect(after.record?.details['prayerCards.language'].value).toBe('spanish');
  });

  it('works on a case still before EDRS, and leaves its workflow, checklist and crematory record alone', async () => {
    const before = caseFixtures.find((c) => c.id === VIEWING_CASE && c.organizationId === GUS)!;
    expect(before.rawStage).toBeLessThan(3);
    appointmentFixtures.push(viewing());
    await save({ kind: 'item', itemId: 'prep.crematory.notified', status: 'completed' });
    const after = caseFixtures.find((c) => c.id === VIEWING_CASE && c.organizationId === GUS)!;
    expect(after.rawStage).toBe(before.rawStage);
    expect(after.checklistState).toEqual(before.checklistState);
    expect(after.checklistCompletions).toEqual(before.checklistCompletions);
    expect(after.crematory).toEqual(before.crematory);
    expect(after.fieldValues).toEqual(before.fieldValues);
  });

  it('links only documents that are on this case', async () => {
    caseDocumentFixtures.push(
      { id: 'doc-here', organizationId: GUS, caseId: VIEWING_CASE, fileName: 'florist-order.pdf', status: 'active', createdAt: '2026-12-01T12:00:00.000Z' } as CaseDocument,
      { id: 'doc-elsewhere', organizationId: GUS, caseId: FINAL_GOODBYE_CASE, fileName: 'other.pdf', status: 'active', createdAt: '2026-12-01T12:00:00.000Z' } as CaseDocument,
    );
    const view = await getServicePreparation(GUS, VIEWING_CASE, 'mock');
    expect(view?.documents).toEqual([{ id: 'doc-here', fileName: 'florist-order.pdf' }]);
    await expect(save({ kind: 'item', itemId: 'prep.crematory.notified', status: 'pending', documentId: 'doc-elsewhere' })).rejects.toMatchObject({ status: 400 });
    const saved = await save({ kind: 'item', itemId: 'prep.crematory.notified', status: 'pending', documentId: 'doc-here' });
    expect(saved.record?.items['prep.crematory.notified'].documentId).toBe('doc-here');
  });
});

describe('multiple staff', () => {
  it('a change to the same entry made against an older version is refused, with the latest returned', async () => {
    const first = await save({ kind: 'choice', choice: 'casket', value: 'rental' });
    const stale = save({ kind: 'choice', choice: 'casket', value: 'purchase' }, null);
    await expect(stale).rejects.toMatchObject({ status: 409 });
    await stale.catch((error) => expect(error.current.record.choices.casket.value).toBe('rental'));
    const fresh = await save({ kind: 'choice', choice: 'casket', value: 'purchase' }, first.record!.choices.casket.at, VIEWING_CASE, ctx(), '2026-12-02T13:00:00.000Z');
    expect(fresh.record?.choices.casket.value).toBe('purchase');
  });

  it('changes by two people to different entries both survive', async () => {
    await save({ kind: 'choice', choice: 'casket', value: 'rental' });
    await save({ kind: 'choice', choice: 'clothing', value: 'none' }, null, VIEWING_CASE, ctx({ actorIdentityId: 'identity-gus-admin' }));
    const view = (await getServicePreparation(GUS, VIEWING_CASE, 'mock'))!;
    expect(view.record?.choices.casket.by).toBe('identity-gus-director');
    expect(view.record?.choices.clothing.by).toBe('identity-gus-admin');
  });
});

describe('rescheduling', () => {
  it('a confirmation for the old date needs confirming again after the appointment moves', async () => {
    appointmentFixtures.push(viewing());
    await save({ kind: 'item', itemId: 'prep.crematory.hold_confirmed', status: 'confirmed' });
    appointmentFixtures[0] = viewing({ startAt: '2026-12-11T15:00:00.000Z', endAt: '2026-12-11T17:00:00.000Z' });
    const view = (await getServicePreparation(GUS, VIEWING_CASE, 'mock'))!;
    const item = summarizeServiceReadiness({ definition: VIEWING_PREPARATION, record: view.record, service: view.service, now: '2026-12-05T12:00:00.000Z' }).items.find((i) => i.id === 'prep.crematory.hold_confirmed')!;
    expect(item.status).toBe('needs_reconfirmation');
    expect(item.record?.forServiceStartAt).toBe('2026-12-10T15:00:00.000Z');

    const again = await save({ kind: 'item', itemId: 'prep.crematory.hold_confirmed', status: 'confirmed' }, view.record!.items['prep.crematory.hold_confirmed'].at, VIEWING_CASE, ctx(), '2026-12-05T12:00:00.000Z');
    expect(again.record?.items['prep.crematory.hold_confirmed'].forServiceStartAt).toBe('2026-12-11T15:00:00.000Z');
  });

  it('the service time a confirmation is for comes from the appointment, never the request', async () => {
    await expect(save({ kind: 'item', itemId: 'prep.crematory.hold_confirmed', status: 'confirmed' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('history', () => {
  it('every change is an Activity event with the entry before and after', async () => {
    appointmentFixtures.push(viewing());
    await save({ kind: 'item', itemId: 'prep.crematory.notified', status: 'pending' });
    const pending = (await getServicePreparation(GUS, VIEWING_CASE, 'mock'))!.record!.items['prep.crematory.notified'];
    await save({ kind: 'item', itemId: 'prep.crematory.notified', status: 'completed' }, pending.at, VIEWING_CASE, ctx(), '2026-12-02T14:00:00.000Z');
    const events = activityEventFixtures.filter((e) => e.eventType === ACTIVITY_EVENT_TYPES.SERVICE_PREPARATION_UPDATED && e.caseId === VIEWING_CASE);
    expect(events).toHaveLength(2);
    expect(events[1].organizationId).toBe(GUS);
    expect(JSON.parse(events[1].previousValue!)['prep.crematory.notified'].status).toBe('pending');
    expect(JSON.parse(events[1].newValue!)['prep.crematory.notified'].status).toBe('completed');
    expect(events[1].description).toMatch(/Crematory told about the service/);
  });
});

describe('where it applies', () => {
  it('another organization cannot read or change a Gus case', async () => {
    expect(await getServicePreparation(DEFAULT_ORGANIZATION_ID, VIEWING_CASE, 'mock')).toBeNull();
    await expect(save({ kind: 'choice', choice: 'casket', value: 'rental' }, null, VIEWING_CASE, ctx({ organizationId: DEFAULT_ORGANIZATION_ID }))).rejects.toMatchObject({ status: 404 });
    expect(caseFixtures.find((c) => c.id === VIEWING_CASE && c.organizationId === GUS)?.servicePreparation).toBeUndefined();
  });

  it('Direct Cremation has none and cannot be given any', async () => {
    expect(await getServicePreparation(GUS, DIRECT_CASE, 'mock')).toBeNull();
    await expect(save({ kind: 'choice', choice: 'casket', value: 'rental' }, null, DIRECT_CASE)).rejects.toMatchObject({ status: 404 });
  });

  it('Manors cases never have it, even with a Viewing service code', async () => {
    const index = caseFixtures.findIndex((c) => c.organizationId === DEFAULT_ORGANIZATION_ID);
    const manors = caseFixtures[index];
    caseFixtures[index] = { ...manors, workflowSnapshot: manors.workflowSnapshot ? { ...manors.workflowSnapshot, serviceTypeCode: 'CREMATION_WITH_VIEWING' } : manors.workflowSnapshot };
    expect(await getServicePreparation(DEFAULT_ORGANIZATION_ID, manors.id, 'mock')).toBeNull();
    await expect(save({ kind: 'choice', choice: 'casket', value: 'rental' }, null, manors.id, ctx({ organizationId: DEFAULT_ORGANIZATION_ID }))).rejects.toMatchObject({ status: 404 });
  });

  it('an archived case is read-only', async () => {
    const index = caseFixtures.findIndex((c) => c.id === VIEWING_CASE && c.organizationId === GUS);
    caseFixtures[index] = { ...caseFixtures[index], isDeleted: true };
    await expect(save({ kind: 'choice', choice: 'casket', value: 'rental' })).rejects.toMatchObject({ status: 409 });
  });

  it('cannot name a cremation step', async () => {
    await expect(save({ kind: 'item', itemId: 'cremation.crematory.authorization_sent', status: 'completed' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('live Wix', () => {
  it('refuses to save until the field is added, without calling Wix', async () => {
    await expect(changeServicePreparation(ctx(), VIEWING_CASE, { change: { kind: 'choice', choice: 'casket', value: 'rental' }, basis: { at: null }, actorName: null }, 'wix')).rejects.toMatchObject({
      status: 503,
      message: SERVICE_PREPARATION_STORAGE_UNAVAILABLE,
    });
    expect(wixDataApi.calls).toBe(0);
  });
});

describe('audit history (Phase 5E)', () => {
  const prepEvents = () => activityEventFixtures.filter((e) => e.eventType === ACTIVITY_EVENT_TYPES.SERVICE_PREPARATION_UPDATED && e.caseId === VIEWING_CASE);

  it('each save has one history entry and exactly one matching Activity event (same id)', async () => {
    const first = await save({ kind: 'choice', choice: 'casket', value: 'rental' });
    const second = await save({ kind: 'choice', choice: 'casket', value: 'purchase' }, first.record!.choices.casket.at, VIEWING_CASE, ctx(), '2026-12-02T13:00:00.000Z');
    const history = second.record!.history!;
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ actorId: 'identity-gus-director', actorName: 'Jordan Demo', at: '2026-12-02T13:00:00.000Z', previous: { value: 'rental' }, next: { value: 'purchase' } });
    expect(prepEvents()).toHaveLength(2);
    expect(prepEvents().map((e) => e.correlationId)).toEqual(history.map((h) => h.eventId));
  });

  it('the server makes the event id and the time; they are unique per change', async () => {
    const saved = await changeServicePreparation(ctx(), VIEWING_CASE, { change: { kind: 'choice', choice: 'casket', value: 'rental' }, basis: { at: null }, actorName: 'Jordan Demo' }, 'mock');
    const [entry] = saved.record!.history!;
    expect(entry.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(entry.at)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('if the Activity write fails, the change and its history entry are still saved, and the failure is logged', async () => {
    activityFailure.fail = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const saved = await save({ kind: 'choice', choice: 'casket', value: 'rental' });
    expect(saved.record!.choices.casket.value).toBe('rental');
    expect(prepEvents()).toHaveLength(0);
    const reloaded = (await getServicePreparation(GUS, VIEWING_CASE, 'mock'))!;
    expect(reloaded.record!.history).toHaveLength(1);
    expect(reloaded.record!.history![0].next).toMatchObject({ value: 'rental' });
    expect(errors.mock.calls.some(([message]) => String(message).includes('was not recorded'))).toBe(true);
    errors.mockRestore();
  });

  it('history survives a reload and a later save', async () => {
    const first = await save({ kind: 'choice', choice: 'casket', value: 'rental' });
    await save({ kind: 'detail', key: 'prayerCards.image', value: 'Fictional sunrise' }, null, VIEWING_CASE, ctx(), '2026-12-02T14:00:00.000Z');
    const reloaded = (await getServicePreparation(GUS, VIEWING_CASE, 'mock'))!;
    expect(reloaded.record!.history!.map((h) => h.target.key)).toEqual(['casket', 'prayerCards.image']);
    expect(reloaded.record!.history![0]).toEqual(first.record!.history![0]);
  });

  it('a stored preparation that cannot be read is never saved over', async () => {
    const index = caseFixtures.findIndex((c) => c.id === VIEWING_CASE && c.organizationId === GUS);
    caseFixtures[index] = { ...caseFixtures[index], servicePreparationUnreadable: true };
    await expect(save({ kind: 'choice', choice: 'casket', value: 'rental' })).rejects.toMatchObject({ status: 409 });
    expect(caseFixtures[index].servicePreparation).toBeUndefined();
  });

  it('a record at the size limit refuses the change, saves nothing, and records no Activity', async () => {
    const index = caseFixtures.findIndex((c) => c.id === VIEWING_CASE && c.organizationId === GUS);
    const full = {
      definitionKey: 'prep.viewing',
      definitionVersion: 1,
      serviceAppointmentId: null,
      choices: {},
      details: {},
      items: {},
      release: null,
      history: Array.from({ length: 400 }, (_, i) => ({
        eventId: `old-${i}`,
        target: { kind: 'detail' as const, key: 'clergy.name' },
        description: 'x'.repeat(300),
        previous: null,
        next: { value: 'y'.repeat(300), at: '2026-12-01T12:00:00.000Z', by: 'identity-fictional' },
        actorId: 'identity-fictional',
        actorName: null,
        at: '2026-12-01T12:00:00.000Z',
      })),
    };
    caseFixtures[index] = { ...caseFixtures[index], servicePreparation: full };
    const revision = caseFixtures[index].revision;
    await expect(save({ kind: 'choice', choice: 'casket', value: 'rental' })).rejects.toMatchObject({ status: 413 });
    expect(caseFixtures[index].servicePreparation).toBe(full);
    expect(caseFixtures[index].revision).toBe(revision);
    expect(prepEvents()).toHaveLength(0);
  });
});
