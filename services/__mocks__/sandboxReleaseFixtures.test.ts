import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetMockStore } from './mockStore';
import { releaseStatusOf, correctionConfirmationRefusal } from '../../domain/servicePreparation/releaseHolds';
import { summarizeServiceReadiness } from '../../domain/servicePreparation/readiness';
import { VIEWING_PREPARATION } from '../../domain/servicePreparation/serviceDefinitions';
import { GUS_ADMIN_IDENTITY_ID, GUS_DIRECTOR_IDENTITY_ID, GUS_ORGANIZATION_ID } from './gusFixtures';

/** Sandbox release-state examples (Gus, 2026-11): only with the sandbox switch, each in its intended state. */
async function load(sandbox: boolean) {
  vi.stubEnv('NEXT_PUBLIC_SOLIS_SANDBOX', sandbox ? 'true' : '');
  resetMockStore();
  vi.resetModules();
  const [fixtures, scheduling] = await Promise.all([import('./fixtures'), import('./schedulingFixtures')]);
  return { cases: fixtures.caseFixtures, appointments: scheduling.appointmentFixtures };
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetMockStore();
  vi.resetModules();
});

describe('sandbox release-state examples', () => {
  it('absent without the sandbox switch', async () => {
    const { cases, appointments } = await load(false);
    expect(cases.some((c) => /^gus-case-9\d\d$/.test(c.id))).toBe(false);
    expect(appointments).toEqual([]);
  });

  it('with it: five fictional Gus Viewing cases, one per release state, preparation complete', async () => {
    const { cases, appointments } = await load(true);
    const examples = cases.filter((c) => /^gus-case-9\d\d$/.test(c.id));
    expect(examples.map((c) => [c.id, releaseStatusOf(c.servicePreparation)])).toEqual([
      ['gus-case-901', 'released'],
      ['gus-case-902', 'on_hold'],
      ['gus-case-903', 'awaiting_reauthorization'],
      ['gus-case-904', 'reauthorized'],
      ['gus-case-905', 'correction_pending'],
    ]);
    for (const c of examples) {
      expect(c.organizationId).toBe(GUS_ORGANIZATION_ID);
      expect(c.decedentName).toMatch(/^EXAMPLE /);
      expect(c.caseNumber).toMatch(/^M\d{4}-9\d\d$/);
      const appointment = appointments.find((a) => a.caseId === c.id)!;
      expect(appointment.status).toBe('completed');
      const service = { appointmentId: appointment.id, startAt: appointment.startAt, endAt: appointment.endAt, status: appointment.status, bookedAt: appointment.createdAt };
      expect(summarizeServiceReadiness({ definition: VIEWING_PREPARATION, record: c.servicePreparation!, service, now: new Date().toISOString() }).ready).toBe(true);
    }
    // Case numbers are unique across every case.
    expect(new Set(cases.map((c) => `${c.organizationId}:${c.caseNumber}`)).size).toBe(cases.length);
    // The pending correction was asked for by the administrator and signed by the director: neither may confirm it.
    const pending = examples.find((c) => c.id === 'gus-case-905')!.servicePreparation;
    expect(correctionConfirmationRefusal(pending, GUS_ADMIN_IDENTITY_ID)).toMatch(/You asked/);
    expect(correctionConfirmationRefusal(pending, GUS_DIRECTOR_IDENTITY_ID)).toMatch(/responsible/);
  });
});
