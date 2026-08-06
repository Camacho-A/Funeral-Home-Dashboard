import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixAppointmentItem, buildWixAppointmentData, applyAppointmentPatchToWixData, type WixAppointmentItem } from '../lib/wixAppointmentMapper';
import {
  mapWixAppointmentResourceAssignmentItem,
  buildWixAppointmentResourceAssignmentData,
  applyAppointmentResourceAssignmentUpdateToWixData,
  type WixAppointmentResourceAssignmentItem,
} from '../lib/wixAppointmentResourceAssignmentMapper';
import type { Appointment, NewAppointmentInput } from '../types/appointment';
import { isTerminalAppointmentStatus } from '../types/appointment';
import type { AppointmentResourceAssignment } from '../types/appointmentResourceAssignment';
import { isValidAppointmentTypeKey } from '../domain/scheduling/appointmentTypeRegistry';
import { checkConflicts, type ConflictDetail } from './scheduling/conflictEngine';
import { createRecurrenceDefinition, computeOccurrences } from './scheduling/recurrenceEngine';
import { listAppointments, getAppointment, listAppointmentsForCase } from './scheduling/appointmentReads';
import { get as getResource } from './resourceService';
import {
  recordAppointmentCreated,
  recordAppointmentUpdated,
  recordAppointmentRescheduled,
  recordAppointmentCancelled,
  recordAppointmentCompleted,
  recordResourceAssigned,
  recordResourceReleased,
  recordResourceConflictOverridden,
  type ActivityContext,
} from './activityService';
import { createSignatureRequest } from './signatureService';
import { assertAssignableStaffProfile, getById as getStaffProfileById, StaffAssignmentError } from './staffProfileService';
import { createNotification } from './notificationService';
import { getAppBaseUrl } from '../lib/env';
import { appointmentFixtures, appointmentResourceAssignmentFixtures } from './__mocks__/schedulingFixtures';

/**
 * Phase 27 (Scheduling & Resource Management). **The single orchestration
 * layer** for everything that touches an `Appointment`'s lifecycle:
 * conflict detection, resource assignment/release, every `ActivityEvent`,
 * recurrence materialization, and the optional witness-signature
 * integration. No Route Handler ever computes a conflict, flips an
 * appointment's status, materializes a recurrence, or calls a
 * `recordAppointment*`/`recordResource*` helper directly — only this
 * file does (structurally enforced, see `services/schedulingService.test.ts`).
 *
 * **Authorization is the caller's job, not this file's.** Exactly like
 * every other service in this codebase, `schedulingService.ts` performs
 * no RBAC check itself — a route must already have verified
 * `resource.manage`-tier authority before ever passing a truthy
 * `override` through to `createAppointment`/`rescheduleAppointment`/
 * `updateAppointmentResources` below.
 */
export class SchedulingServiceError extends Error {
  hardConflicts?: ConflictDetail[];
  constructor(message: string, hardConflicts?: ConflictDetail[]) {
    super(message);
    this.hardConflicts = hardConflicts;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Persistence — Appointment
// ---------------------------------------------------------------------------

async function persistAppointment(appointment: Appointment, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    appointmentFixtures.push(appointment);
    return;
  }
  await insertWixDataItem<WixAppointmentItem>('appointments', buildWixAppointmentData(appointment), appointment.id);
}

async function patchAppointment(organizationId: string, appointmentId: string, patch: Partial<Omit<Appointment, 'id' | 'organizationId'>>, dataAdapterMode: DataAdapterMode): Promise<Appointment> {
  if (dataAdapterMode === 'mock') {
    const index = appointmentFixtures.findIndex((a) => a.id === appointmentId && a.organizationId === organizationId);
    if (index === -1) throw new SchedulingServiceError('Appointment not found.');
    appointmentFixtures[index] = { ...appointmentFixtures[index], ...patch };
    return appointmentFixtures[index];
  }
  const response = await queryWixDataItems<WixAppointmentItem>('appointments', { filter: { organizationId, beaconAppointmentId: appointmentId }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new SchedulingServiceError('Appointment not found.');
  const merged = applyAppointmentPatchToWixData(existingItem.data, patch as Partial<WixAppointmentItem>);
  const updated = await updateWixDataItem<WixAppointmentItem>('appointments', existingItem.id, merged);
  const mapped = mapWixAppointmentItem(updated.data);
  if (!mapped) throw new SchedulingServiceError('Failed to update appointment.');
  return mapped;
}

// ---------------------------------------------------------------------------
// Persistence — AppointmentResourceAssignment
// ---------------------------------------------------------------------------

async function persistAssignment(assignment: AppointmentResourceAssignment, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    appointmentResourceAssignmentFixtures.push(assignment);
    return;
  }
  await insertWixDataItem<WixAppointmentResourceAssignmentItem>('appointmentResourceAssignments', buildWixAppointmentResourceAssignmentData(assignment), assignment.id);
}

async function patchAssignment(
  organizationId: string,
  assignmentId: string,
  patch: Partial<Pick<AppointmentResourceAssignment, 'startAt' | 'endAt' | 'status' | 'releasedAt'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<AppointmentResourceAssignment> {
  if (dataAdapterMode === 'mock') {
    const index = appointmentResourceAssignmentFixtures.findIndex((a) => a.id === assignmentId && a.organizationId === organizationId);
    if (index === -1) throw new SchedulingServiceError('Resource assignment not found.');
    appointmentResourceAssignmentFixtures[index] = { ...appointmentResourceAssignmentFixtures[index], ...patch };
    return appointmentResourceAssignmentFixtures[index];
  }
  const response = await queryWixDataItems<WixAppointmentResourceAssignmentItem>('appointmentResourceAssignments', {
    filter: { organizationId, beaconAssignmentId: assignmentId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new SchedulingServiceError('Resource assignment not found.');
  const merged = applyAppointmentResourceAssignmentUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixAppointmentResourceAssignmentItem>('appointmentResourceAssignments', existingItem.id, merged);
  const mapped = mapWixAppointmentResourceAssignmentItem(updated.data);
  if (!mapped) throw new SchedulingServiceError('Failed to update resource assignment.');
  return mapped;
}

export async function listResourceAssignments(organizationId: string, appointmentId: string, dataAdapterMode: DataAdapterMode): Promise<AppointmentResourceAssignment[]> {
  if (dataAdapterMode === 'mock') {
    return appointmentResourceAssignmentFixtures.filter((a) => a.organizationId === organizationId && a.appointmentId === appointmentId);
  }
  const response = await queryWixDataItems<WixAppointmentResourceAssignmentItem>('appointmentResourceAssignments', { filter: { organizationId, appointmentId } });
  return response.dataItems.map((item) => mapWixAppointmentResourceAssignmentItem(item.data)).filter((a): a is AppointmentResourceAssignment => a !== null);
}

async function createAssignment(appointment: Appointment, resourceId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<void> {
  const resource = await getResource(ctx.organizationId, resourceId, dataAdapterMode);
  if (!resource) throw new SchedulingServiceError(`Resource "${resourceId}" not found.`);

  const assignment: AppointmentResourceAssignment = {
    id: `${appointment.id}-${resourceId}`,
    organizationId: ctx.organizationId,
    appointmentId: appointment.id,
    resourceId,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status,
    assignmentRole: null,
    assignedAt: nowIso(),
    releasedAt: null,
    createdBy: ctx.actorIdentityId ?? 'unknown',
  };
  await persistAssignment(assignment, dataAdapterMode);

  try {
    await recordResourceAssigned(ctx, appointment.caseId, appointment.id, resourceId, resource.name, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record scheduling.resource.assigned activity event:', error instanceof Error ? error.message : error);
  }
}

async function releaseAssignmentRow(organizationId: string, assignment: AppointmentResourceAssignment, caseId: string | null, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<void> {
  await patchAssignment(organizationId, assignment.id, { releasedAt: nowIso() }, dataAdapterMode);
  try {
    const resource = await getResource(organizationId, assignment.resourceId, dataAdapterMode);
    await recordResourceReleased(ctx, caseId, assignment.appointmentId, assignment.resourceId, resource?.name ?? assignment.resourceId, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record scheduling.resource.released activity event:', error instanceof Error ? error.message : error);
  }
}

async function releaseAllLiveAssignments(organizationId: string, appointmentId: string, caseId: string | null, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<void> {
  const assignments = await listResourceAssignments(organizationId, appointmentId, dataAdapterMode);
  for (const assignment of assignments.filter((a) => a.releasedAt === null)) {
    await releaseAssignmentRow(organizationId, assignment, caseId, ctx, dataAdapterMode);
  }
}

async function recordOverrides(ctx: ActivityContext, caseId: string | null, appointmentId: string, hardConflicts: ConflictDetail[], reason: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  for (const conflict of hardConflicts) {
    try {
      await recordResourceConflictOverridden(ctx, caseId, appointmentId, conflict.resourceId, conflict.resourceName, reason, dataAdapterMode);
    } catch (error) {
      console.error('Failed to record scheduling.resource.conflict_overridden activity event:', error instanceof Error ? error.message : error);
    }
  }
}

/**
 * Phase 30 (Identity Model Hardening & Staff Assignment Unification):
 * completes one of the three notification integrations Phase 28 deferred
 * — additive, best-effort, never fails the actual appointment mutation,
 * mirroring every other `record*` call's try/catch convention above.
 * Notifies whoever is `Appointment.ownerStaffProfileId` (if set) that
 * "their" appointment was created/rescheduled/cancelled. A dangling or
 * unresolvable `ownerStaffProfileId` is silently skipped — never thrown —
 * per this phase's read-side policy for pre-existing dangling references
 * (the same rule `recipientResolver.ts`'s `case_participants` scope
 * follows): no owner is a valid, non-error outcome, not every appointment
 * has one.
 */
async function notifyAppointmentOwner(
  notificationType: 'scheduling.appointment_created' | 'scheduling.appointment_rescheduled' | 'scheduling.appointment_cancelled',
  appointment: Appointment,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  if (!appointment.ownerStaffProfileId) return;
  try {
    const owner = await getStaffProfileById(ctx.organizationId, appointment.ownerStaffProfileId, dataAdapterMode);
    if (!owner) return;
    await createNotification(
      {
        notificationType,
        entityType: 'appointment',
        entityId: appointment.id,
        recipientScope: 'individual',
        recipientIdentityId: owner.identityId,
        caseId: appointment.caseId ?? undefined,
        actionUrl: `${getAppBaseUrl()}/dashboard`,
        tokens: { entityTitle: appointment.title },
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
  } catch (error) {
    console.error(`Failed to send ${notificationType} notification:`, error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------------------
// Reads — re-exported from services/scheduling/appointmentReads.ts (see that
// file's own header comment for why the reads live in a separate module:
// documentService.ts needs them for the merge engine without creating an
// import cycle through this file's own signatureService.ts dependency).
// ---------------------------------------------------------------------------

export { listAppointments, getAppointment, listAppointmentsForCase };

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function createAppointment(params: NewAppointmentInput & { idFactory: () => string; now?: string }, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<Appointment> {
  if (!isValidAppointmentTypeKey(params.appointmentType)) {
    throw new SchedulingServiceError(`Unrecognized appointment type: "${params.appointmentType}".`);
  }

  const now = params.now ?? nowIso();
  const resourceIds = params.resourceIds ?? [];
  const willBeDraft = params.saveAsDraft === true || resourceIds.length === 0;

  let hardConflicts: ConflictDetail[] = [];
  if (!willBeDraft) {
    hardConflicts = (await checkConflicts(ctx.organizationId, resourceIds, params.startAt, params.endAt, dataAdapterMode)).hardConflicts;
    if (hardConflicts.length > 0 && !params.override) {
      throw new SchedulingServiceError(
        `Scheduling conflict: ${hardConflicts.map((c) => c.resourceName).join(', ')} unavailable for this time.`,
        hardConflicts,
      );
    }
  }

  // Phase 30 (Identity Model Hardening & Staff Assignment Unification): a
  // real, active, in-organization StaffProfile, gated by schedule.edit —
  // never a phantom/inactive/cross-org id, never a StaffProfile.role check.
  if (params.ownerStaffProfileId) {
    try {
      await assertAssignableStaffProfile(
        {
          organizationId: ctx.organizationId,
          staffProfileId: params.ownerStaffProfileId,
          permission: 'schedule.edit',
          actor: { identityId: ctx.actorIdentityId ?? '', organizationId: ctx.organizationId, roleKey: ctx.actorRoleKey ?? '' },
        },
        dataAdapterMode,
      );
    } catch (error) {
      throw error instanceof StaffAssignmentError ? new SchedulingServiceError(error.message) : error;
    }
  }

  const appointmentId = params.idFactory();
  const appointment: Appointment = {
    id: appointmentId,
    organizationId: ctx.organizationId,
    caseId: params.caseId ?? null,
    appointmentType: params.appointmentType,
    title: params.title,
    notes: params.notes ?? null,
    locationId: params.locationId ?? null,
    status: willBeDraft ? 'draft' : 'scheduled',
    startAt: params.startAt,
    endAt: params.endAt,
    timezone: params.timezone,
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: params.ownerStaffProfileId ?? null,
    createdBy: ctx.actorIdentityId ?? 'unknown',
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: ctx.correlationId,
    createdAt: now,
    updatedAt: now,
  };

  await persistAppointment(appointment, dataAdapterMode);

  if (hardConflicts.length > 0 && params.override) {
    await recordOverrides(ctx, appointment.caseId, appointmentId, hardConflicts, params.override.reason, dataAdapterMode);
  }

  try {
    await recordAppointmentCreated(ctx, appointment.caseId, appointmentId, appointment.appointmentType, appointment.startAt, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record scheduling.appointment.created activity event:', error instanceof Error ? error.message : error);
  }
  await notifyAppointmentOwner('scheduling.appointment_created', appointment, ctx, dataAdapterMode);

  if (!willBeDraft) {
    for (const resourceId of resourceIds) {
      await createAssignment(appointment, resourceId, ctx, dataAdapterMode);
    }
  }

  if (params.recurrence) {
    const definition = await createRecurrenceDefinition(
      ctx.organizationId,
      { ...params.recurrence, createdBy: ctx.actorIdentityId ?? 'unknown', idFactory: params.idFactory, now },
      dataAdapterMode,
    );
    await patchAppointment(ctx.organizationId, appointmentId, { recurrenceDefinitionId: definition.id }, dataAdapterMode);
    appointment.recurrenceDefinitionId = definition.id;

    const occurrences = computeOccurrences(definition, appointment.startAt, appointment.endAt);
    // occurrences[0] is this same appointment, already created above — materialize only the rest.
    for (const occurrence of occurrences.slice(1)) {
      await createRecurringOccurrence(appointment, occurrence, resourceIds, willBeDraft, ctx, dataAdapterMode, params);
    }
  }

  return appointment;
}

/** A materialized occurrence beyond the first. Conflict-checked
    independently — a conflict here never aborts the whole series; the
    affected occurrence is created as `draft` (needing staff attention)
    with no resource assignments, rather than failing the entire batch. */
async function createRecurringOccurrence(
  master: Appointment,
  occurrence: { startAt: string; endAt: string },
  resourceIds: string[],
  masterWillBeDraft: boolean,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
  params: NewAppointmentInput & { idFactory: () => string; now?: string },
): Promise<void> {
  const now = params.now ?? nowIso();
  let occurrenceIsDraft = masterWillBeDraft;
  let occurrenceHardConflicts: ConflictDetail[] = [];

  if (!masterWillBeDraft && resourceIds.length > 0) {
    const { hardConflicts } = await checkConflicts(ctx.organizationId, resourceIds, occurrence.startAt, occurrence.endAt, dataAdapterMode);
    if (hardConflicts.length > 0 && !params.override) {
      occurrenceIsDraft = true;
      occurrenceHardConflicts = hardConflicts;
    } else if (hardConflicts.length > 0) {
      occurrenceHardConflicts = hardConflicts;
    }
  }

  const occAppointment: Appointment = {
    ...master,
    id: params.idFactory(),
    startAt: occurrence.startAt,
    endAt: occurrence.endAt,
    status: occurrenceIsDraft ? 'draft' : 'scheduled',
    isRecurrenceException: false,
    createdAt: now,
    updatedAt: now,
  };
  await persistAppointment(occAppointment, dataAdapterMode);

  try {
    await recordAppointmentCreated(ctx, occAppointment.caseId, occAppointment.id, occAppointment.appointmentType, occAppointment.startAt, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record scheduling.appointment.created activity event:', error instanceof Error ? error.message : error);
  }

  if (!occurrenceIsDraft) {
    if (occurrenceHardConflicts.length > 0 && params.override) {
      await recordOverrides(ctx, occAppointment.caseId, occAppointment.id, occurrenceHardConflicts, params.override.reason, dataAdapterMode);
    }
    for (const resourceId of resourceIds) {
      await createAssignment(occAppointment, resourceId, ctx, dataAdapterMode);
    }
  }
}

export async function rescheduleAppointment(
  organizationId: string,
  appointmentId: string,
  changes: { startAt: string; endAt: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
  override?: { reason: string },
): Promise<Appointment> {
  const existing = await getAppointment(organizationId, appointmentId, dataAdapterMode);
  if (!existing) throw new SchedulingServiceError('Appointment not found.');
  if (isTerminalAppointmentStatus(existing.status)) throw new SchedulingServiceError('This appointment can no longer be edited.');

  const assignments = await listResourceAssignments(organizationId, appointmentId, dataAdapterMode);
  const liveAssignments = assignments.filter((a) => a.releasedAt === null);
  const resourceIds = liveAssignments.map((a) => a.resourceId);

  if (resourceIds.length > 0) {
    const { hardConflicts } = await checkConflicts(organizationId, resourceIds, changes.startAt, changes.endAt, dataAdapterMode, { excludeAppointmentId: appointmentId });
    if (hardConflicts.length > 0) {
      if (!override) {
        throw new SchedulingServiceError(`Scheduling conflict: ${hardConflicts.map((c) => c.resourceName).join(', ')} unavailable for this time.`, hardConflicts);
      }
      await recordOverrides(ctx, existing.caseId, appointmentId, hardConflicts, override.reason, dataAdapterMode);
    }
  }

  const patch: Partial<Appointment> = { startAt: changes.startAt, endAt: changes.endAt, lastModifiedBy: ctx.actorIdentityId ?? null, updatedAt: nowIso() };
  if (existing.recurrenceDefinitionId !== null && !existing.isRecurrenceException) {
    patch.isRecurrenceException = true;
  }
  const updated = await patchAppointment(organizationId, appointmentId, patch, dataAdapterMode);

  for (const assignment of liveAssignments) {
    await patchAssignment(organizationId, assignment.id, { startAt: changes.startAt, endAt: changes.endAt }, dataAdapterMode);
  }

  try {
    await recordAppointmentRescheduled(ctx, existing.caseId, appointmentId, { startAt: existing.startAt, endAt: existing.endAt }, { startAt: changes.startAt, endAt: changes.endAt }, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record scheduling.appointment.rescheduled activity event:', error instanceof Error ? error.message : error);
  }
  await notifyAppointmentOwner('scheduling.appointment_rescheduled', updated, ctx, dataAdapterMode);

  return updated;
}

export async function updateAppointmentResources(
  organizationId: string,
  appointmentId: string,
  changes: { addResourceIds?: string[]; removeResourceIds?: string[] },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
  override?: { reason: string },
): Promise<void> {
  const existing = await getAppointment(organizationId, appointmentId, dataAdapterMode);
  if (!existing) throw new SchedulingServiceError('Appointment not found.');
  if (isTerminalAppointmentStatus(existing.status)) throw new SchedulingServiceError('This appointment can no longer be edited.');

  const addResourceIds = changes.addResourceIds ?? [];
  if (addResourceIds.length > 0) {
    const { hardConflicts } = await checkConflicts(organizationId, addResourceIds, existing.startAt, existing.endAt, dataAdapterMode, { excludeAppointmentId: appointmentId });
    if (hardConflicts.length > 0) {
      if (!override) {
        throw new SchedulingServiceError(`Scheduling conflict: ${hardConflicts.map((c) => c.resourceName).join(', ')} unavailable for this time.`, hardConflicts);
      }
      await recordOverrides(ctx, existing.caseId, appointmentId, hardConflicts, override.reason, dataAdapterMode);
    }
    for (const resourceId of addResourceIds) {
      await createAssignment(existing, resourceId, ctx, dataAdapterMode);
    }
  }

  const removeResourceIds = changes.removeResourceIds ?? [];
  if (removeResourceIds.length > 0) {
    const assignments = await listResourceAssignments(organizationId, appointmentId, dataAdapterMode);
    for (const assignment of assignments.filter((a) => a.releasedAt === null && removeResourceIds.includes(a.resourceId))) {
      await releaseAssignmentRow(organizationId, assignment, existing.caseId, ctx, dataAdapterMode);
    }
  }

  if (existing.status === 'draft' && addResourceIds.length > 0) {
    await patchAppointment(organizationId, appointmentId, { status: 'scheduled', updatedAt: nowIso() }, dataAdapterMode);
  }
}

export async function confirmAppointment(organizationId: string, appointmentId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<Appointment> {
  const existing = await getAppointment(organizationId, appointmentId, dataAdapterMode);
  if (!existing) throw new SchedulingServiceError('Appointment not found.');
  if (isTerminalAppointmentStatus(existing.status)) throw new SchedulingServiceError('This appointment can no longer be edited.');

  const updated = await patchAppointment(organizationId, appointmentId, { status: 'confirmed', lastModifiedBy: ctx.actorIdentityId ?? null, updatedAt: nowIso() }, dataAdapterMode);
  try {
    await recordAppointmentUpdated(ctx, existing.caseId, appointmentId, { status: { previous: existing.status, next: 'confirmed' } }, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record scheduling.appointment.updated activity event:', error instanceof Error ? error.message : error);
  }
  return updated;
}

export async function startAppointment(organizationId: string, appointmentId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<Appointment> {
  const existing = await getAppointment(organizationId, appointmentId, dataAdapterMode);
  if (!existing) throw new SchedulingServiceError('Appointment not found.');
  if (isTerminalAppointmentStatus(existing.status)) throw new SchedulingServiceError('This appointment can no longer be edited.');

  const updated = await patchAppointment(organizationId, appointmentId, { status: 'in_progress', lastModifiedBy: ctx.actorIdentityId ?? null, updatedAt: nowIso() }, dataAdapterMode);
  try {
    await recordAppointmentUpdated(ctx, existing.caseId, appointmentId, { status: { previous: existing.status, next: 'in_progress' } }, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record scheduling.appointment.updated activity event:', error instanceof Error ? error.message : error);
  }
  return updated;
}

export async function completeAppointment(organizationId: string, appointmentId: string, outcome: 'completed' | 'no_show', ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<Appointment> {
  const existing = await getAppointment(organizationId, appointmentId, dataAdapterMode);
  if (!existing) throw new SchedulingServiceError('Appointment not found.');
  if (isTerminalAppointmentStatus(existing.status)) throw new SchedulingServiceError('This appointment can no longer be edited.');

  const updated = await patchAppointment(organizationId, appointmentId, { status: outcome, lastModifiedBy: ctx.actorIdentityId ?? null, updatedAt: nowIso() }, dataAdapterMode);
  await releaseAllLiveAssignments(organizationId, appointmentId, existing.caseId, ctx, dataAdapterMode);

  try {
    await recordAppointmentCompleted(ctx, existing.caseId, appointmentId, outcome, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record scheduling.appointment.completed activity event:', error instanceof Error ? error.message : error);
  }
  return updated;
}

export async function cancelAppointment(organizationId: string, appointmentId: string, reason: string | null, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<Appointment> {
  const existing = await getAppointment(organizationId, appointmentId, dataAdapterMode);
  if (!existing) throw new SchedulingServiceError('Appointment not found.');
  if (isTerminalAppointmentStatus(existing.status)) throw new SchedulingServiceError('This appointment can no longer be cancelled.');

  const now = nowIso();
  const updated = await patchAppointment(
    organizationId,
    appointmentId,
    { status: 'cancelled', cancelledAt: now, cancelledBy: ctx.actorIdentityId ?? null, cancelReason: reason, updatedAt: now },
    dataAdapterMode,
  );
  await releaseAllLiveAssignments(organizationId, appointmentId, existing.caseId, ctx, dataAdapterMode);

  try {
    await recordAppointmentCancelled(ctx, existing.caseId, appointmentId, reason, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record scheduling.appointment.cancelled activity event:', error instanceof Error ? error.message : error);
  }
  await notifyAppointmentOwner('scheduling.appointment_cancelled', updated, ctx, dataAdapterMode);
  return updated;
}

/** Thin wrapper over the existing signatureService — a Witness Cremation
    appointment's witness signature is just another SignatureRequest
    (widened SignerRole: 'witness'), never a parallel signing mechanism.
    See docs/adr/ADR-030's own "Extension points" section and
    types/signatureRequest.ts's SignerRole comment. */
export async function createWitnessSignatureRequest(
  appointment: Appointment,
  documentId: string,
  witnessName: string,
  witnessEmail: string,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
) {
  if (!appointment.caseId) {
    throw new SchedulingServiceError('A witness signature request requires an appointment linked to a case.');
  }
  return createSignatureRequest(
    { caseId: appointment.caseId, documentId, signerName: witnessName, signerEmail: witnessEmail, signerRole: 'witness', idFactory: () => `${appointment.id}-witness-${nowIso()}` },
    ctx,
    dataAdapterMode,
  );
}
