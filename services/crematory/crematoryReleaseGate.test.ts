import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The Send to Crematory release gate end to end (Gus Phase 5K), with the
 * gate turned on for Gus IN THIS FILE ONLY. It is off in the real profile.
 * Mock mode, fictional cases; nothing is sent.
 */
vi.mock('@/domain/organization/organizationProfiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/organization/organizationProfiles')>();
  return {
    ...actual,
    getRegisteredOrganizationProfile: (organizationId: string) => {
      const profile = actual.getRegisteredOrganizationProfile(organizationId);
      if (organizationId !== actual.GUS_CAMACHO_ORGANIZATION_ID) return profile;
      return { ...profile, features: { ...profile.features, sendToCrematory: { ...profile.features.sendToCrematory!, requireReleaseAfterService: true } } };
    },
  };
});

const { getCrematoryCaseSummary, recordPreviousSend } = await import('./crematoryPackageService');
const { crematorySentChecklistKeys, crematorySentChecklistReleaseRefusal, maySetCrematorySentStepsByHand } = await import('@/domain/crematory/sentChecklistItems');
const { activityEventFixtures } = await import('../__mocks__/activityEventFixtures');
const { caseFixtures } = await import('../__mocks__/fixtures');
const { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } = await import('@/domain/organization/organizationProfiles');

const GUS = GUS_CAMACHO_ORGANIZATION_ID;
const originals = caseFixtures.map((c) => c);
afterEach(() => originals.forEach((c, i) => (caseFixtures[i] = c)));
const gate = async (organizationId: string, caseId: string) =>
  (await getCrematoryCaseSummary(organizationId, caseId, true, 'mock')).readiness.requirements.find((r) => r.key === 'released_for_cremation');

describe('release gate on (test only)', () => {
  it('a Gus Viewing case lists the release as a sending requirement until it is recorded', async () => {
    expect(await gate(GUS, 'gus-case-010')).toMatchObject({ ok: false });
    const i = caseFixtures.findIndex((c) => c.id === 'gus-case-010' && c.organizationId === GUS);
    caseFixtures[i] = {
      ...caseFixtures[i],
      servicePreparation: {
        definitionKey: 'prep.viewing',
        definitionVersion: 2,
        serviceAppointmentId: null,
        choices: {},
        details: {},
        items: {},
        release: { releasedAt: '2026-12-11T15:00:00.000Z', releasedBy: 'identity-gus-director', releasedByName: 'Jordan Demo', roleKey: 'funeralDirector' },
      },
    };
    expect(await gate(GUS, 'gus-case-010')).toMatchObject({ ok: true });
  });

  it('a Gus Direct Cremation case and every Manors case are unaffected', async () => {
    const direct = caseFixtures.find((c) => c.organizationId === GUS && !c.workflowSnapshot?.serviceTypeCode?.includes('WITH'))!;
    expect(await gate(GUS, direct.id)).toBeUndefined();
    const manors = caseFixtures.find((c) => c.organizationId === MANORS_ORGANIZATION_ID && c.caseType === 'cremation')!;
    expect(await gate(MANORS_ORGANIZATION_ID, manors.id)).toBeUndefined();
  });
});

const releasedPrep = (events: unknown[]) => ({
  definitionKey: 'prep.viewing',
  definitionVersion: 2,
  serviceAppointmentId: null,
  choices: {},
  details: {},
  items: {},
  release: { releasedAt: '2026-12-11T15:00:00.000Z', releasedBy: 'identity-gus-director', releasedByName: 'Jordan Demo', roleKey: 'funeralDirector', eventId: 'r1' },
  releaseEvents: events,
});
const ev = (type: string, extra: Record<string, unknown> = {}) => ({ eventId: type, type, at: '2026-12-11T15:00:00.000Z', actorId: 'x', actorName: 'Morgan Demo', roleKey: 'manager', ...extra });

describe('holds and indirect paths (gate on, test only)', () => {
  it('a hold blocks sending again, and says why; reauthorization unblocks it', async () => {
    const i = caseFixtures.findIndex((c) => c.id === 'gus-case-010' && c.organizationId === GUS);
    caseFixtures[i] = { ...caseFixtures[i], servicePreparation: releasedPrep([ev('released'), ev('hold_placed', { reason: 'Family asked to wait' })]) as never };
    const held = await gate(GUS, 'gus-case-010');
    expect(held).toMatchObject({ ok: false });
    expect(held!.detail).toMatch(/on hold \(Family asked to wait\)/);
    caseFixtures[i] = { ...caseFixtures[i], servicePreparation: releasedPrep([ev('released'), ev('hold_placed', { reason: 'x' }), ev('reauthorized', { approval: {} })]) as never };
    expect(await gate(GUS, 'gus-case-010')).toMatchObject({ ok: true });
  });

  it('a pending reauthorization request still blocks sending', async () => {
    const i = caseFixtures.findIndex((c) => c.id === 'gus-case-010' && c.organizationId === GUS);
    caseFixtures[i] = { ...caseFixtures[i], servicePreparation: releasedPrep([ev('released'), ev('hold_placed', { reason: 'x' }), ev('reauthorization_requested')]) as never };
    expect(await gate(GUS, 'gus-case-010')).toMatchObject({ ok: false });
  });

  it('recording a send "made outside SOLIS" is refused for an unreleased or held case; "not previously sent" is still allowed', async () => {
    const i = caseFixtures.findIndex((c) => c.id === 'gus-case-010' && c.organizationId === GUS);
    const keys = crematorySentChecklistKeys(caseFixtures[i]);
    expect(keys.length).toBeGreaterThan(0);
    caseFixtures[i] = { ...caseFixtures[i], checklistState: { ...caseFixtures[i].checklistState, ...Object.fromEntries(keys.map((k) => [k, true])) } };
    const ctx = { organizationId: GUS, actorIdentityId: 'identity-gus-admin', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'c' };
    const outside = { decision: 'sent_outside_solis', method: 'email', sentOn: null, verification: 'Checked the shared mailbox sent items (fictional)' };
    await expect(recordPreviousSend(ctx, 'gus-case-010', outside, 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('must be released for cremation') });
    caseFixtures[i] = { ...caseFixtures[i], servicePreparation: releasedPrep([ev('released'), ev('hold_placed', { reason: 'Family asked to wait' })]) as never };
    await expect(recordPreviousSend(ctx, 'gus-case-010', outside, 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('on hold') });
    const notSent = { decision: 'not_previously_sent', verification: 'Checked the shared mailbox sent items (fictional)', confirmedChecked: true };
    await expect(recordPreviousSend(ctx, 'gus-case-010', notSent, 'mock')).resolves.toBeTruthy();
  });
});

describe('recording an external send (gate on, test only) — approved 2026-11-20', () => {
  const ctx = { organizationId: GUS, actorIdentityId: 'identity-gus-manager-fictional', actorMembershipId: null, actorRoleKey: 'manager', correlationId: 'c' };
  const outside = { decision: 'sent_outside_solis', method: 'email', sentOn: null, verification: 'Checked the shared mailbox sent items (fictional)' };
  // The "sent" steps already checked by hand: a possible earlier send.
  const withPrep = (events: unknown[]) => {
    const i = caseFixtures.findIndex((c) => c.id === 'gus-case-010' && c.organizationId === GUS);
    const keys = crematorySentChecklistKeys(caseFixtures[i]);
    caseFixtures[i] = { ...caseFixtures[i], checklistState: { ...caseFixtures[i].checklistState, ...Object.fromEntries(keys.map((k) => [k, true])) }, servicePreparation: releasedPrep(events) as never };
  };

  it('with a valid release (not on hold) it is recorded, and clearly marked as sent outside SOLIS', async () => {
    withPrep([ev('released')]);
    activityEventFixtures.length = 0;
    const summary = await recordPreviousSend(ctx, 'gus-case-010', outside, 'mock');
    expect(summary.previousSend?.recorded?.decision).toBe('sent_outside_solis');
    expect(activityEventFixtures.at(-1)!.description).toMatch(/outside SOLIS/);
  });

  it('a corrected sign-off (now on hold) refuses it', async () => {
    withPrep([ev('released'), ev('release_corrected', { reason: 'Wrong appointment', correctsEventId: 'released' })]);
    await expect(recordPreviousSend(ctx, 'gus-case-010', outside, 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('on hold') });
  });
});

describe('who may mark the sending steps by hand — approved 2026-11-20', () => {
  it('Gus: Administrator, Manager and Funeral Director; never read-only or an unknown role', () => {
    for (const role of ['administrator', 'manager', 'funeralDirector']) expect(maySetCrematorySentStepsByHand(GUS, role, false), role).toBe(true);
    for (const role of ['readOnly', 'staff', null]) expect(maySetCrematorySentStepsByHand(GUS, role, false), String(role)).toBe(false);
  });

  it('Manors is unchanged: administrators only', () => {
    expect(maySetCrematorySentStepsByHand(MANORS_ORGANIZATION_ID, 'manager', false)).toBe(false);
    expect(maySetCrematorySentStepsByHand(MANORS_ORGANIZATION_ID, 'funeralDirector', false)).toBe(false);
    expect(maySetCrematorySentStepsByHand(MANORS_ORGANIZATION_ID, 'administrator', true)).toBe(true);
  });
});

describe('checking the "sent to crematory" steps (gate on, test only)', () => {
  it('checking is refused until released, refused on hold, allowed once reauthorized; unchecking is always allowed', () => {
    const c = caseFixtures.find((x) => x.id === 'gus-case-010' && x.organizationId === GUS)!;
    const [key] = crematorySentChecklistKeys(c);
    expect(crematorySentChecklistReleaseRefusal(c, { [key]: true })).toMatch(/must be released/);
    const held = { ...c, servicePreparation: releasedPrep([ev('released'), ev('hold_placed', { reason: 'Family asked to wait' })]) as never };
    expect(crematorySentChecklistReleaseRefusal(held, { [key]: true })).toMatch(/on hold/);
    const reauthorized = { ...c, servicePreparation: releasedPrep([ev('released'), ev('hold_placed', { reason: 'x' }), ev('reauthorized', { approval: {} })]) as never };
    expect(crematorySentChecklistReleaseRefusal(reauthorized, { [key]: true })).toBeNull();
    const ticked = { ...held, checklistState: { ...held.checklistState, [key]: true } };
    expect(crematorySentChecklistReleaseRefusal(ticked, { [key]: false })).toBeNull();
  });

  it('a Gus Direct Cremation case and Manors are never refused', () => {
    const direct = caseFixtures.find((x) => x.organizationId === GUS && !x.workflowSnapshot?.serviceTypeCode?.includes('WITH') && crematorySentChecklistKeys(x).length > 0);
    if (direct) expect(crematorySentChecklistReleaseRefusal(direct, { [crematorySentChecklistKeys(direct)[0]]: true })).toBeNull();
    const manors = caseFixtures.find((x) => x.organizationId === MANORS_ORGANIZATION_ID && crematorySentChecklistKeys(x).length > 0)!;
    expect(crematorySentChecklistReleaseRefusal(manors, { [crematorySentChecklistKeys(manors)[0]]: true })).toBeNull();
  });
});
