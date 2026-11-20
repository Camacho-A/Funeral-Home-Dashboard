import type { Appointment } from '../../types/appointment';
import type { Case } from '../../types/case';
import type { ReleaseEvent, ReleaseEventType, ServiceEvent, ServicePreparationRecord } from '../../domain/servicePreparation/types';
import { VIEWING_PREPARATION } from '../../domain/servicePreparation/serviceDefinitions';
import { applyPreparationChange, type PreparationChange } from '../../domain/servicePreparation/preparationUpdates';
import { appendReleaseEvent } from '../../domain/servicePreparation/releaseHolds';
import { formatCaseNumber } from '../../domain/cases/caseNumber';
import { isSandboxEnabled } from '../../lib/sandbox';
import { releaseReadyViewingCase } from './gusReleaseFixtures';
import {
  buildGusCaseFixtures,
  fictionalDirectorLicense,
  GUS_ADMIN_IDENTITY_ID,
  GUS_CASE_NUMBER_PREFIX,
  GUS_DIRECTOR_IDENTITY_ID,
  GUS_DIRECTOR_STAFF_ID,
  GUS_ORGANIZATION_ID,
} from './gusFixtures';

/**
 * Sandbox release-state examples (Gus, 2026-11). Fictional Viewing cases,
 * each with a completed viewing and its preparation finished, frozen in one
 * release state so the release card can be checked in a browser while
 * release itself stays switched off. Present ONLY with the sandbox switch
 * on (lib/sandbox.ts); local development and every test see the ordinary
 * fixtures. Every event is built through the real release rules
 * (appendReleaseEvent), so each record is one the workflow could produce.
 *
 *   M<year>-901 Released
 *   M<year>-902 On Hold
 *   M<year>-903 Reauthorization requested
 *   M<year>-904 Reauthorized
 *   M<year>-905 Correction awaiting independent confirmation
 *   M<year>-906 Not released yet — every requirement met, ready for a
 *               licensed sign-off (the full workflow can be walked through
 *               in tests; in the sandbox the buttons stay disabled while
 *               release is switched off)
 *
 * Every case carries the legal steps, the permit and the ME approval
 * (releaseReadyViewingCase), so its requirement list reads as it would in
 * real use.
 *
 * Numbered 901+ so they never collide with a case the sandbox creates.
 */

type Actor = { id: string; name: string; roleKey: string };
const ADMIN: Actor = { id: GUS_ADMIN_IDENTITY_ID, name: 'Avery Demo', roleKey: 'administrator' };
const DIRECTOR: Actor = { id: GUS_DIRECTOR_IDENTITY_ID, name: 'Jordan Demo', roleKey: 'funeralDirector' };

type Step = { type: ReleaseEventType; actor: Actor; reason?: string; corrects?: 'last_sign_off' };
type Seed = { number: number; decedentName: string; nextOfKinName: string; steps: Step[] };

const HOLD_REASON = 'Family asked to wait for a relative travelling in (fictional example)';

const SEEDS: readonly Seed[] = [
  { number: 901, decedentName: 'EXAMPLE RELEASED', nextOfKinName: 'SAMPLE FAMILY ONE', steps: [{ type: 'release_requested', actor: ADMIN }, { type: 'released', actor: DIRECTOR }] },
  { number: 902, decedentName: 'EXAMPLE ON HOLD', nextOfKinName: 'SAMPLE FAMILY TWO', steps: [{ type: 'released', actor: DIRECTOR }, { type: 'hold_placed', actor: ADMIN, reason: HOLD_REASON }] },
  {
    number: 903,
    decedentName: 'EXAMPLE REAUTHORIZATION REQUESTED',
    nextOfKinName: 'SAMPLE FAMILY THREE',
    steps: [{ type: 'released', actor: DIRECTOR }, { type: 'hold_placed', actor: ADMIN, reason: HOLD_REASON }, { type: 'reauthorization_requested', actor: ADMIN }],
  },
  {
    number: 904,
    decedentName: 'EXAMPLE REAUTHORIZED',
    nextOfKinName: 'SAMPLE FAMILY FOUR',
    steps: [{ type: 'released', actor: DIRECTOR }, { type: 'hold_placed', actor: ADMIN, reason: HOLD_REASON }, { type: 'reauthorization_requested', actor: ADMIN }, { type: 'reauthorized', actor: DIRECTOR }],
  },
  {
    number: 905,
    decedentName: 'EXAMPLE CORRECTION PENDING',
    nextOfKinName: 'SAMPLE FAMILY FIVE',
    steps: [{ type: 'released', actor: DIRECTOR }, { type: 'correction_requested', actor: ADMIN, reason: 'Sign-off recorded against the wrong viewing (fictional example)', corrects: 'last_sign_off' }],
  },
  { number: 906, decedentName: 'EXAMPLE READY FOR RELEASE', nextOfKinName: 'SAMPLE FAMILY SIX', steps: [] },
];

const HOUR = 60 * 60 * 1000;
const caseIdOf = (seed: Seed) => `gus-case-${seed.number}`;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Yesterday's viewing, 15:00–17:00 UTC, completed. */
function viewingFor(seed: Seed, now: Date): Appointment {
  const start = new Date(startOfUtcDay(now).getTime() - 24 * HOUR + 15 * HOUR);
  const at = start.toISOString();
  return {
    id: `sandbox-viewing-${seed.number}`,
    organizationId: GUS_ORGANIZATION_ID,
    caseId: caseIdOf(seed),
    appointmentType: VIEWING_PREPARATION.serviceAppointmentType,
    title: 'Viewing (fictional example)',
    notes: null,
    locationId: null,
    status: 'completed',
    startAt: at,
    endAt: new Date(start.getTime() + 2 * HOUR).toISOString(),
    timezone: 'America/New_York',
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: GUS_DIRECTOR_STAFF_ID,
    createdBy: GUS_ADMIN_IDENTITY_ID,
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: `sandbox-viewing-${seed.number}`,
    createdAt: new Date(start.getTime() - 48 * HOUR).toISOString(),
    updatedAt: at,
  };
}

/** Every required preparation step done, nothing extra requested, then the release steps. */
function preparationFor(seed: Seed, appointment: Appointment, now: Date): ServicePreparationRecord {
  const service: ServiceEvent = { appointmentId: appointment.id, startAt: appointment.startAt, endAt: appointment.endAt, status: 'completed', bookedAt: appointment.createdAt };
  const prepAt = new Date(new Date(appointment.startAt).getTime() - 4 * HOUR).toISOString();
  const changes: PreparationChange[] = [
    ...VIEWING_PREPARATION.choices.map((c): PreparationChange => ({ kind: 'choice', choice: c.key, value: 'not_requested' })),
    ...VIEWING_PREPARATION.groups
      .flatMap((g) => g.items)
      .filter((i) => i.requirement === 'required')
      .map((i): PreparationChange => ({ kind: 'item', itemId: i.id, status: i.kind === 'task' ? 'completed' : 'confirmed' })),
  ];
  let record = changes.reduce<ServicePreparationRecord | null>(
    (r, change, i) => applyPreparationChange({ definition: VIEWING_PREPARATION, record: r, service, change, actor: { id: ADMIN.id, name: ADMIN.name }, now: prepAt, eventId: `sandbox-prep-${seed.number}-${i}` }),
    null,
  )!;
  const license = fictionalDirectorLicense(now);
  const firstEventAt = new Date(appointment.endAt).getTime() + HOUR;
  seed.steps.forEach((step, i) => {
    const signOff = step.type === 'released' || step.type === 'reauthorized';
    const lastSignOff = record.releaseEvents?.filter((e) => e.type === 'released' || e.type === 'reauthorized').at(-1);
    const event: ReleaseEvent = {
      eventId: `sandbox-release-${seed.number}-${i}`,
      type: step.type,
      at: new Date(Math.min(firstEventAt + i * HOUR, now.getTime())).toISOString(),
      actorId: step.actor.id,
      actorName: step.actor.name,
      roleKey: step.actor.roleKey,
      reason: step.reason ?? null,
      ...(step.corrects === 'last_sign_off' && lastSignOff ? { correctsEventId: lastSignOff.eventId } : {}),
      ...(step.type === 'hold_placed' || step.type === 'correction_requested' ? { paperworkAlreadyTransmitted: false } : {}),
      ...(signOff
        ? {
            approval: {
              staffProfileId: GUS_DIRECTOR_STAFF_ID,
              basis: 'funeral_director_role' as const,
              licenseNumber: license.licenseNumber,
              licenseState: license.state,
              licenseExpiresOn: license.expiresOn,
              licenseVerifiedAt: license.verification?.verifiedAt ?? null,
              licenseVerifiedBy: license.verification?.verifiedBy ?? null,
              serviceAppointmentId: appointment.id,
              prerequisites: [{ key: 'service_completed', label: 'Viewing marked completed' }],
            },
          }
        : {}),
    };
    record = appendReleaseEvent({ definition: VIEWING_PREPARATION, record, event });
  });
  return record;
}

export function sandboxReleaseStateAppointments(now: Date = new Date()): Appointment[] {
  if (!isSandboxEnabled()) return [];
  return SEEDS.map((seed) => viewingFor(seed, now));
}

export function sandboxReleaseStateCases(now: Date = new Date()): Case[] {
  if (!isSandboxEnabled()) return [];
  const base = buildGusCaseFixtures(now).find((c) => c.workflowSnapshot?.serviceTypeCode === VIEWING_PREPARATION.serviceTypeCode)!;
  const year = startOfUtcDay(now).getUTCFullYear();
  return SEEDS.map((seed) => {
    const appointment = viewingFor(seed, now);
    const ready = releaseReadyViewingCase({ ...structuredClone(base), id: caseIdOf(seed) }, now.toISOString());
    return {
      ...ready,
      id: caseIdOf(seed),
      caseNumber: formatCaseNumber(year, seed.number, GUS_CASE_NUMBER_PREFIX),
      decedentName: seed.decedentName,
      nextOfKinName: seed.nextOfKinName,
      nextOfKinPhone: `(555) 010-0${seed.number}`,
      nextOfKinEmail: null,
      assignedStaffId: GUS_DIRECTOR_STAFF_ID,
      createdBy: GUS_DIRECTOR_STAFF_ID,
      intakeOwnerId: GUS_DIRECTOR_STAFF_ID,
      servicePreparation: preparationFor(seed, appointment, now),
    };
  });
}
