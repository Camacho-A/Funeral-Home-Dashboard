import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGusCaseFixtures } from './__mocks__/gusFixtures';
import type { Case } from '../types/case';
import type { LoadedCaseRow, CaseRetryResult } from './caseWriteService';
import type { ServicePreparationRecord } from '../domain/servicePreparation/types';

/**
 * Service preparation in Wix mode (Gus Phase 5E): what happens when Wix's
 * answer to a save is unclear. Wix itself is never called — the case write
 * service, reads and Activity are stubbed. Fictional data only; live
 * saving stays switched off in the real code (servicePreparationStorage).
 */

const wixDataApi = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../lib/wixDataApi', async () => {
  const actual = await vi.importActual<object>('../lib/wixDataApi');
  const refuse = () => {
    wixDataApi.calls += 1;
    throw new Error('Wix must not be called in this test');
  };
  return { ...actual, queryWixDataItems: refuse, queryAllWixDataItems: refuse, conditionalPatchWixDataItemFields: refuse, insertWixDataItem: refuse };
});
vi.mock('./servicePreparationStorage', () => ({ SERVICE_PREPARATION_WIX_FIELD_ADDED: true, servicePreparationStorageAvailable: () => true }));

const viewingCase: Case = buildGusCaseFixtures(new Date('2026-12-01T12:00:00.000Z')).find((c) => c.id === 'gus-case-010')!;
const state = vi.hoisted(() => ({
  writeResult: null as null | ((decided: Record<string, unknown>) => unknown),
  readBack: null as null | (() => unknown),
  writes: 0,
  activity: [] as unknown[],
}));
vi.mock('./serverCaseLoader', () => ({ loadCaseOnServer: vi.fn(async () => viewingCase) }));
vi.mock('./scheduling/appointmentReads', () => ({
  listAppointmentsForCase: vi.fn(async () => [
    { id: 'appt-viewing', organizationId: 'gus-camacho-jr', caseId: 'gus-case-010', appointmentType: 'viewing', startAt: '2026-12-10T15:00:00.000Z', endAt: '2026-12-10T17:00:00.000Z', status: 'scheduled', createdAt: '2026-12-01T12:00:00.000Z' },
  ]),
}));
vi.mock('./documentService', () => ({ list: vi.fn(async () => []) }));
vi.mock('./caseWriteService', () => ({
  writeMockCase: vi.fn(() => {
    throw new Error('mock write must not be used in Wix mode');
  }),
  updateCaseWithRetry: vi.fn(async (_org: string, _case: string, decide: (row: LoadedCaseRow) => Record<string, unknown> | null) => {
    state.writes += 1;
    const decided = decide({ id: 'wix-row', data: {} as never, case_: viewingCase }) as Record<string, unknown>;
    return state.writeResult!(decided);
  }),
  loadCaseRow: vi.fn(async () => state.readBack!()),
}));
vi.mock('./activityService', async () => {
  const actual = await vi.importActual<object>('./activityService');
  return { ...actual, recordServicePreparationChange: vi.fn(async (ctx: unknown, caseId: string, details: unknown) => void state.activity.push({ ctx, caseId, details })) };
});

const { changeServicePreparation } = await import('./servicePreparationService');

const ctx = { organizationId: 'gus-camacho-jr', actorIdentityId: 'identity-gus-director', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'corr-fictional' };
const EVENT = 'evt-fictional-1';
const change = { kind: 'choice' as const, choice: 'prayerCards', value: 'requested' };
const run = () => changeServicePreparation(ctx, 'gus-case-010', { change, basis: { at: null }, actorName: 'Jordan Demo', eventId: EVENT }, 'wix');

const rowWith = (record: ServicePreparationRecord | undefined): LoadedCaseRow => ({ id: 'wix-row', data: {} as never, case_: { ...viewingCase, servicePreparation: record } });

beforeEach(() => {
  state.writes = 0;
  state.activity = [];
  wixDataApi.calls = 0;
});

describe('unclear Wix answers are settled by reading the case back', () => {
  it('saved after all: reported as saved, with one Activity event, and no second write', async () => {
    let decided: ServicePreparationRecord | undefined;
    state.writeResult = (fields) => {
      decided = fields.servicePreparation as ServicePreparationRecord;
      return { result: 'failed', status: 0, reason: 'response lost (fictional)' } satisfies CaseRetryResult;
    };
    state.readBack = () => rowWith(decided);
    const saved = await run();
    expect(saved.record?.choices.prayerCards.value).toBe('requested');
    expect(saved.record?.history?.[0].eventId).toBe(EVENT);
    expect(state.writes).toBe(1);
    expect(state.activity).toHaveLength(1);
    expect((state.activity[0] as { ctx: { correlationId: string } }).ctx.correlationId).toBe(EVENT);
  });

  it('not saved: reported as not saved, no Activity event, no second write', async () => {
    state.writeResult = () => ({ result: 'failed', status: 0, reason: 'response lost (fictional)' });
    state.readBack = () => rowWith(undefined);
    await expect(run()).rejects.toMatchObject({ status: 503, message: 'This change was not saved. Please try again.' });
    expect(state.writes).toBe(1);
    expect(state.activity).toHaveLength(0);
  });

  it('the write call itself throws (network), and the change did land: saved', async () => {
    let decided: ServicePreparationRecord | undefined;
    state.writeResult = (fields) => {
      decided = fields.servicePreparation as ServicePreparationRecord;
      throw new Error('socket hang up (fictional)');
    };
    state.readBack = () => rowWith(decided);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const saved = await run();
    errors.mockRestore();
    expect(saved.record?.history?.map((e) => e.eventId)).toEqual([EVENT]);
    expect(state.writes).toBe(1);
  });

  it('the case cannot even be read back: says it could not confirm, and never retries', async () => {
    state.writeResult = () => ({ result: 'failed', status: 0, reason: 'response lost (fictional)' });
    state.readBack = () => {
      throw new Error('Wix unavailable (fictional)');
    };
    await expect(run()).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/could not confirm/) });
    expect(state.writes).toBe(1);
    expect(state.activity).toHaveLength(0);
  });

  it('a clear success writes once and records one Activity event', async () => {
    state.writeResult = (fields) => ({ result: 'applied', case_: { ...viewingCase, servicePreparation: fields.servicePreparation as ServicePreparationRecord }, row: rowWith(undefined) });
    const saved = await run();
    expect(saved.record?.history).toHaveLength(1);
    expect(state.activity).toHaveLength(1);
  });

  it('never touches Wix directly from here', () => {
    expect(wixDataApi.calls).toBe(0);
  });
});
