import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';
import { appointmentFixtures } from './__mocks__/schedulingFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { completedViewingAppointment, releaseReadyViewingCase } from './__mocks__/gusReleaseFixtures';
import { GUS_CAMACHO_ORGANIZATION_ID } from '../domain/organization/organizationProfiles';
import { listUpcomingServices } from './upcomingServicesService';
import type { Appointment } from '../types/appointment';

/** Upcoming services (Gus Phase 5L) — mock mode, fictional data, read-only. */
const GUS = GUS_CAMACHO_ORGANIZATION_ID;
const NOW = new Date().toISOString();
const DAY = 24 * 60 * 60 * 1000;
const originals = caseFixtures.map((c) => c);
const index = (id: string) => caseFixtures.findIndex((c) => c.id === id && c.organizationId === GUS);
const viewing = (overrides: Partial<Appointment> = {}): Appointment => ({
  ...completedViewingAppointment(GUS, 'gus-case-010', NOW),
  status: 'scheduled',
  startAt: new Date(Date.parse(NOW) + 2 * DAY).toISOString(),
  endAt: new Date(Date.parse(NOW) + 2 * DAY + 2 * 60 * 60 * 1000).toISOString(),
  ...overrides,
});

beforeEach(() => {
  appointmentFixtures.length = 0;
});
afterEach(() => originals.forEach((c, i) => (caseFixtures[i] = c)));

describe('listUpcomingServices', () => {
  it('lists a scheduled Viewing with its preparation progress', async () => {
    appointmentFixtures.push(viewing());
    const [row, ...rest] = (await listUpcomingServices(GUS, 'mock', NOW))!;
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ caseId: 'gus-case-010', serviceName: 'Viewing', status: 'scheduled', released: false, awaitingRelease: true, ready: false });
    expect(row.total).toBeGreaterThan(0);
    expect(row.completed).toBe(0);
  });

  it('a held service stays until released, then drops off', async () => {
    appointmentFixtures.push(completedViewingAppointment(GUS, 'gus-case-010', NOW));
    caseFixtures[index('gus-case-010')] = releaseReadyViewingCase(originals[index('gus-case-010')], NOW);
    expect((await listUpcomingServices(GUS, 'mock', NOW))![0]).toMatchObject({ status: 'completed', awaitingRelease: true });
    const c = caseFixtures[index('gus-case-010')];
    caseFixtures[index('gus-case-010')] = { ...c, servicePreparation: { ...c.servicePreparation!, release: { releasedAt: NOW, releasedBy: 'identity-gus-director', releasedByName: 'Jordan Demo', roleKey: 'funeralDirector' } } };
    expect(await listUpcomingServices(GUS, 'mock', NOW)).toEqual([]);
  });

  it('ignores cancelled services, services outside the window, and archived cases', async () => {
    appointmentFixtures.push(viewing({ status: 'cancelled' }));
    appointmentFixtures.push(viewing({ id: 'far', startAt: new Date(Date.parse(NOW) + 30 * DAY).toISOString(), endAt: new Date(Date.parse(NOW) + 30 * DAY + 3600000).toISOString() }));
    expect(await listUpcomingServices(GUS, 'mock', NOW)).toEqual([]);
    appointmentFixtures.length = 0;
    appointmentFixtures.push(viewing());
    caseFixtures[index('gus-case-010')] = { ...caseFixtures[index('gus-case-010')], isDeleted: true };
    expect(await listUpcomingServices(GUS, 'mock', NOW)).toEqual([]);
  });

  it('another organization’s appointment never shows, and Manors has no list', async () => {
    appointmentFixtures.push({ ...viewing(), organizationId: DEFAULT_ORGANIZATION_ID });
    expect(await listUpcomingServices(GUS, 'mock', NOW)).toEqual([]);
    expect(await listUpcomingServices(DEFAULT_ORGANIZATION_ID, 'mock', NOW)).toBeNull();
  });
});
