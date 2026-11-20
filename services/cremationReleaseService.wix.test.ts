import { beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';
import { buildGusStaffFixtures, fictionalDirectorLicense } from './__mocks__/gusFixtures';
import { completedViewingAppointment, releaseReadyViewingCase } from './__mocks__/gusReleaseFixtures';
import { GUS_CAMACHO_ORGANIZATION_ID } from '../domain/organization/organizationProfiles';
import type { Case } from '../types/case';

/**
 * Recording a release through the LIVE (Wix) path — Gus Phase 5K. Wix and
 * every loader are replaced by fakes; nothing reaches Wix. The two switches
 * (release, and preparation saving on Wix) are toggled per test.
 */
const GUS = GUS_CAMACHO_ORGANIZATION_ID;
const NOW = new Date().toISOString();
const state = vi.hoisted(() => ({
  releaseOn: true,
  storageOn: true,
  case_: null as unknown as Case,
  /** What updateCaseWithRetry does: 'apply' runs the decision and stores it. */
  write: 'apply' as 'apply' | 'conflict' | 'throw' | 'apply-then-throw',
  readBack: 'stored' as 'stored' | 'fails',
  writes: 0,
}));

vi.mock('../domain/servicePreparation/releaseForCremation', async () => {
  const actual = await vi.importActual<object>('../domain/servicePreparation/releaseForCremation');
  return {
    ...actual,
    get RELEASE_FOR_CREMATION_AVAILABLE() {
      return state.releaseOn;
    },
  };
});
vi.mock('./servicePreparationStorage', () => ({ servicePreparationStorageAvailable: (mode: string) => mode === 'mock' || state.storageOn, SERVICE_PREPARATION_WIX_FIELD_ADDED: false }));
vi.mock('./serverCaseLoader', () => ({ loadCaseOnServer: vi.fn(async (org: string, id: string) => (org === state.case_.organizationId && id === state.case_.id ? structuredClone(state.case_) : null)) }));
vi.mock('./scheduling/appointmentReads', () => ({ listAppointmentsForCase: vi.fn(async () => [completedViewingAppointment(GUS, 'gus-case-010', NOW)]) }));
vi.mock('./organizationProvisioningService', () => ({ getOrganization: vi.fn(async () => ({ timezone: 'America/New_York' })) }));
const director = vi.hoisted(() => ({ value: null as unknown as Record<string, unknown> }));
vi.mock('./staffProfileService', () => ({ resolveStaffProfileForCaller: vi.fn(async ({ userId }: { userId: string }) => (userId === 'identity-gus-director' ? director.value : null)) }));
vi.mock('./funeralDirectorCredentialService', () => ({ withCredentials: vi.fn(async (s: object) => s) }));
vi.mock('./activityService', () => ({ recordCremationRelease: vi.fn(async () => undefined) }));
vi.mock('../lib/wixCaseMapper', () => ({ buildCaseFieldPatch: (_data: unknown, update: Record<string, unknown>) => update }));
vi.mock('./caseWriteService', () => ({
  writeMockCase: vi.fn(),
  loadCaseRow: vi.fn(async () => {
    if (state.readBack === 'fails') throw new Error('network');
    return { id: 'wix-row', data: {}, case_: structuredClone(state.case_) };
  }),
  updateCaseWithRetry: vi.fn(async (_org: string, _id: string, decide: (row: unknown) => Record<string, unknown>) => {
    state.writes++;
    if (state.write === 'throw') throw new Error('socket hang up');
    if (state.write === 'conflict') return { result: 'conflict', current: null };
    const patch = decide({ id: 'wix-row', data: {}, case_: structuredClone(state.case_) });
    state.case_ = { ...state.case_, ...patch } as Case;
    if (state.write === 'apply-then-throw') throw new Error('timeout after write');
    return { result: 'applied', case_: structuredClone(state.case_), row: {} };
  }),
}));

const { approveCremationRelease, CremationReleaseError, performReleaseAction } = await import('./cremationReleaseService');
const caller = { organizationId: GUS, userId: 'identity-gus-director', role: 'funeralDirector' };

beforeEach(() => {
  Object.assign(state, { releaseOn: true, storageOn: true, write: 'apply', readBack: 'stored', writes: 0 });
  state.case_ = releaseReadyViewingCase(caseFixtures.find((c) => c.id === 'gus-case-010' && c.organizationId === GUS)!, NOW);
  const staff = buildGusStaffFixtures().find((s) => s.identityId === 'identity-gus-director')!;
  director.value = { ...staff, funeralDirectorLicense: fictionalDirectorLicense(new Date(NOW)), funeralDirectorAuthorization: null };
});

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CremationReleaseError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
};

describe('release on the live path (fake Wix)', () => {
  it('both switches off (today): refused with 423 before anything is sent to Wix', async () => {
    Object.assign(state, { releaseOn: false, storageOn: false });
    expect((await refusal(approveCremationRelease(caller, 'gus-case-010', 'wix', { now: NOW }))).status).toBe(423);
    Object.assign(state, { releaseOn: true, storageOn: false });
    expect((await refusal(approveCremationRelease(caller, 'gus-case-010', 'wix', { now: NOW }))).status).toBe(423);
    Object.assign(state, { releaseOn: false, storageOn: true });
    expect((await refusal(approveCremationRelease(caller, 'gus-case-010', 'wix', { now: NOW }))).status).toBe(423);
    expect(state.writes).toBe(0);
  });

  it('saves the release with its history entry in one conditional write', async () => {
    const { release } = await approveCremationRelease(caller, 'gus-case-010', 'wix', { now: NOW, eventId: 'release-live-1' });
    expect(state.writes).toBe(1);
    expect(release!.eventId).toBe('release-live-1');
    expect(state.case_.servicePreparation!.history!.at(-1)!.eventId).toBe('release-live-1');
  });

  it('decided again at write time: a requirement withdrawn in between refuses it and nothing is stored', async () => {
    const { updateCaseWithRetry } = await import('./caseWriteService');
    vi.mocked(updateCaseWithRetry).mockImplementationOnce(async (_o, _i, decide) => {
      state.writes++;
      const changed = { ...state.case_, crematory: { ...state.case_.crematory, medicalExaminerApproval: null } } as Case;
      await decide({ id: 'wix-row', data: {}, case_: changed } as never);
      return { result: 'applied', case_: changed, row: {} as never };
    });
    expect((await refusal(approveCremationRelease(caller, 'gus-case-010', 'wix', { now: NOW }))).status).toBe(409);
    expect(state.case_.servicePreparation!.release ?? null).toBeNull();
  });

  it('a write conflict (someone else saved first) is refused, not retried blindly', async () => {
    state.write = 'conflict';
    expect((await refusal(approveCremationRelease(caller, 'gus-case-010', 'wix', { now: NOW }))).status).toBe(409);
    expect(state.writes).toBe(1);
  });

  it('an unclear answer is settled by reading back: saved → success', async () => {
    state.write = 'apply-then-throw';
    const { release } = await approveCremationRelease(caller, 'gus-case-010', 'wix', { now: NOW, eventId: 'release-live-2' });
    expect(release!.eventId).toBe('release-live-2');
    expect(state.writes).toBe(1);
  });

  it('an unclear answer is settled by reading back: not saved → 503; read-back fails → 503 asking to check first', async () => {
    state.write = 'throw';
    const notSaved = await refusal(approveCremationRelease(caller, 'gus-case-010', 'wix', { now: NOW }));
    expect(notSaved.status).toBe(503);
    expect(notSaved.message).toMatch(/not saved/);
    state.readBack = 'fails';
    const unknown = await refusal(approveCremationRelease(caller, 'gus-case-010', 'wix', { now: NOW }));
    expect(unknown.status).toBe(503);
    expect(unknown.message).toMatch(/could not confirm/);
    expect(state.writes).toBe(2);
  });

  it('someone outside the operational roles and not a licensed director is refused before any write', async () => {
    expect((await refusal(approveCremationRelease({ ...caller, role: 'arranger' }, 'gus-case-010', 'wix', { now: NOW }))).status).toBe(403);
    expect(state.writes).toBe(0);
  });

  it('a Funeral Director whose license is missing records a request, not a release', async () => {
    director.value = { ...director.value, funeralDirectorLicense: null };
    const result = await approveCremationRelease(caller, 'gus-case-010', 'wix', { now: NOW });
    expect(result.status).toBe('awaiting_signoff');
    expect(result.release).toBeNull();
  });

  it('a hold whose save gets an unclear answer is settled by read-back; a second hold is then refused, not duplicated', async () => {
    await approveCremationRelease(caller, 'gus-case-010', 'wix', { now: NOW });
    state.write = 'apply-then-throw';
    const held = await performReleaseAction({ ...caller, role: 'manager', userId: 'identity-gus-manager-fictional' }, 'gus-case-010', 'wix', { action: 'hold', reason: 'Family asked to wait', now: NOW, eventId: 'hold-live' });
    expect(held.status).toBe('on_hold');
    state.write = 'apply';
    expect((await refusal(performReleaseAction({ ...caller, role: 'manager' }, 'gus-case-010', 'wix', { action: 'hold', reason: 'again', now: NOW }))).status).toBe(409);
    expect(state.case_.servicePreparation!.releaseEvents!.filter((e) => e.type === 'hold_placed')).toHaveLength(1);
  });
});
