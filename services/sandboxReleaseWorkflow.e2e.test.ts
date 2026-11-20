import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * The full release and hold workflow on the sandbox's release-ready
 * fictional case (M<year>-906, gus-case-906) — mock data with the sandbox
 * fixtures loaded. Release for cremation is switched on IN THIS FILE ONLY;
 * it stays off in the code and in the sandbox, so nothing here can happen
 * on a deployment. Nothing is sent anywhere.
 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SOLIS_SANDBOX = 'true';
});
vi.mock('../domain/servicePreparation/releaseForCremation', async () => ({
  ...(await vi.importActual<object>('../domain/servicePreparation/releaseForCremation')),
  RELEASE_FOR_CREMATION_AVAILABLE: true,
}));

const { evaluateCremationReleaseForCaller, performReleaseAction } = await import('./cremationReleaseService');
const { changeServicePreparation, getServicePreparation } = await import('./servicePreparationService');
const { releaseGateRefusal } = await import('../domain/servicePreparation/releaseForCremation');
const { caseFixtures } = await import('./__mocks__/fixtures');

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SOLIS_SANDBOX;
});

const GUS = 'gus-camacho-jr';
const CASE = 'gus-case-906';
const NOW = new Date().toISOString();
const admin = { organizationId: GUS, userId: 'identity-gus-admin', role: 'administrator' };
const director = { organizationId: GUS, userId: 'identity-gus-director', role: 'funeralDirector' };
const manager = { organizationId: GUS, userId: 'identity-gus-manager-fictional', role: 'manager' };
const viewer = { organizationId: GUS, userId: 'identity-gus-viewer', role: 'readOnly' };
const refusal = (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number }) => e.status ?? 500);
const gateOn = () => releaseGateRefusal(caseFixtures.find((c) => c.id === CASE)!, true);
const ctx = { organizationId: GUS, actorIdentityId: admin.userId, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'c' };

describe('sandbox case M-906: request → sign-off → hold → change on hold → reauthorize → corrected → reauthorize', () => {
  it('every step, with every safeguard', async () => {
    // Ready: every requirement met for the licensed director; the gate (if it were on) refuses until released.
    const before = (await evaluateCremationReleaseForCaller(director, CASE, 'mock', NOW))!;
    expect(before).toMatchObject({ status: 'not_released', allPrerequisitesMet: true });
    expect(before.prerequisites.filter((p) => !p.met)).toEqual([]);
    expect(gateOn()).toMatch(/must be released/);
    // The administrator holds no license: every case requirement met, but not the signer's.
    const asAdmin = (await evaluateCremationReleaseForCaller(admin, CASE, 'mock', NOW))!;
    expect(asAdmin.casePrerequisitesMet).toBe(true);
    expect(asAdmin.prerequisites.filter((p) => !p.met).map((p) => p.key).sort()).toEqual(['approver_authorized', 'approver_licensed']);

    // Read-only staff can do nothing.
    expect(await refusal(performReleaseAction(viewer, CASE, 'mock', { action: 'release', now: NOW }))).toBe(403);

    // 1. Administrator requests; only the licensed director signs off.
    expect((await performReleaseAction(admin, CASE, 'mock', { action: 'release', now: NOW, eventId: 's-req' })).status).toBe('awaiting_signoff');
    expect(await refusal(performReleaseAction(admin, CASE, 'mock', { action: 'sign_off', now: NOW }))).toBe(403);
    expect((await performReleaseAction(director, CASE, 'mock', { action: 'sign_off', now: NOW, eventId: 's-rel' })).status).toBe('released');
    expect(gateOn()).toBeNull();

    // 2. Manager places a hold (reason required); sending blocked.
    expect(await refusal(performReleaseAction(manager, CASE, 'mock', { action: 'hold', now: NOW }))).toBe(400);
    expect((await performReleaseAction(manager, CASE, 'mock', { action: 'hold', reason: 'Family asked to wait (fictional)', now: NOW, eventId: 's-hold' })).status).toBe('on_hold');
    expect(gateOn()).toMatch(/on hold/);

    // 3. A preparation change while on hold needs a reason and is recorded as made during the hold.
    const change = { kind: 'choice' as const, choice: 'casketSpray', value: 'requested' };
    await expect(changeServicePreparation(ctx, CASE, { change, basis: undefined as never, actorName: 'Avery Demo', now: NOW }, 'mock')).rejects.toMatchObject({ status: 400 });
    const current = (await getServicePreparation(GUS, CASE, 'mock'))!.record!;
    await changeServicePreparation(ctx, CASE, { change, basis: { at: current.choices.casketSpray?.at ?? null }, actorName: 'Avery Demo', now: NOW, reason: 'Family now wants a spray (fictional)' }, 'mock');
    expect((await getServicePreparation(GUS, CASE, 'mock'))!.record!.history!.at(-1)).toMatchObject({ duringHold: true });

    // 4. Manager requests reauthorization; the director signs off after a recheck.
    expect((await performReleaseAction(manager, CASE, 'mock', { action: 'reauthorize', now: NOW })).status).toBe('awaiting_reauthorization');
    expect(gateOn()).not.toBeNull();
    expect((await performReleaseAction(director, CASE, 'mock', { action: 'sign_off', now: NOW, eventId: 's-reauth' })).status).toBe('reauthorized');
    expect(gateOn()).toBeNull();

    // 5. Manager asks to correct the sign-off in force: blocked until someone independent confirms.
    expect((await performReleaseAction(manager, CASE, 'mock', { action: 'correct', reason: 'Wrong viewing selected (fictional)', correctsEventId: 's-reauth', now: NOW })).status).toBe('correction_pending');
    expect(gateOn()).not.toBeNull();
    expect(await refusal(performReleaseAction(manager, CASE, 'mock', { action: 'confirm_correction', now: NOW }))).toBe(403); // asked for it
    expect(await refusal(performReleaseAction(director, CASE, 'mock', { action: 'confirm_correction', now: NOW }))).toBe(403); // signed it
    expect((await performReleaseAction(admin, CASE, 'mock', { action: 'confirm_correction', now: NOW })).status).toBe('on_hold');

    // 6. Lifted only by a licensed reauthorization.
    expect((await performReleaseAction(director, CASE, 'mock', { action: 'reauthorize', now: NOW })).status).toBe('reauthorized');

    const record = (await getServicePreparation(GUS, CASE, 'mock'))!.record!;
    expect(record.release!.eventId).toBe('s-rel'); // the original release, unchanged
    expect(record.releaseEvents!.map((e) => e.type)).toEqual([
      'release_requested', 'released', 'hold_placed', 'reauthorization_requested', 'reauthorized', 'correction_requested', 'release_corrected', 'reauthorized',
    ]);
  });
});
