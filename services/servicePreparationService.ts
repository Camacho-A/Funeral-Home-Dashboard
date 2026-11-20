import crypto from 'crypto';
import { getRegisteredOrganizationProfile } from '../domain/organization/organizationProfiles';
import { servicePreparationFor } from '../domain/servicePreparation/serviceDefinitions';
import { selectServiceEvent } from '../domain/servicePreparation/readiness';
import {
  applyPreparationChange,
  PreparationChangeError,
  PreparationConflictError,
  PreparationLimitError,
  type PreparationChange,
  type PreparationChangeBasis,
} from '../domain/servicePreparation/preparationUpdates';
import type { ServiceEvent, ServicePreparationDefinition, ServicePreparationRecord } from '../domain/servicePreparation/types';
import { buildCaseFieldPatch } from '../lib/wixCaseMapper';
import type { DataAdapterMode } from '../lib/env';
import type { Case, CaseUpdate } from '../types/case';
import { recordServicePreparationChange, type ActivityContext } from './activityService';
import { loadCaseRow, updateCaseWithRetry, writeMockCase } from './caseWriteService';
import { servicePreparationStorageAvailable } from './servicePreparationStorage';
import { list as listCaseDocuments } from './documentService';
import { listAppointmentsForCase } from './scheduling/appointmentReads';
import { loadCaseOnServer } from './serverCaseLoader';

/**
 * Service preparation storage (Gus Phase 5C, 2026-11). The ONE writer of
 * the case's `servicePreparation` field.
 *
 * - Organization-scoped throughout: the case, its appointments and its
 *   documents are read for the caller's organization only; another
 *   organization's case is "not found".
 * - Only organizations with service preparation (Gus), and only cases
 *   whose service has a preparation; Direct Cremation and Manors never.
 * - Every write goes through the case revision check (caseWriteService):
 *   it is decided from the case as it is NOW, and re-decided if another
 *   write landed first, so no one's change is lost. A change to the SAME
 *   entry someone else changed is refused (PreparationConflictError).
 * - The service date a confirmation is for comes from the case's own
 *   appointment, read here — never from the browser.
 * - Nothing here touches the checklist, the stage, the crematory record
 *   or any legal step, and nothing is sent.
 *
 * LIVE WIX: saving is switched off in services/servicePreparationStorage.ts
 * until separately approved; reads are safe.
 *
 * AUDIT (Phase 5E): each change gets a server-generated event id and is
 * saved together with its history entry (domain/servicePreparation/
 * preparationUpdates.ts) in one revision-checked write. The Activity event
 * is written afterwards with the same id as its correlationId; if that
 * fails it is logged, and the history entry in the record still holds the
 * change. When Wix's answer to a save is unclear, the case is read back
 * and the event id decides whether it was saved — the write is never
 * blindly retried.
 */
export { SERVICE_PREPARATION_WIX_FIELD_ADDED, servicePreparationStorageAvailable } from './servicePreparationStorage';

export const SERVICE_PREPARATION_STORAGE_UNAVAILABLE =
  'Saving preparation is not available on this site yet: the case field that stores it has not been added. Nothing was saved.';

function isDecisionError(error: unknown): boolean {
  return error instanceof ServicePreparationError || error instanceof PreparationConflictError || error instanceof PreparationChangeError || error instanceof PreparationLimitError;
}

export class ServicePreparationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly current: ServicePreparationView | null = null,
  ) {
    super(message);
  }
}

export type ServicePreparationView = {
  applies: true;
  definitionKey: string;
  record: ServicePreparationRecord | null;
  service: ServiceEvent | null;
  documents: { id: string; fileName: string }[];
  isArchived: boolean;
  storageAvailable: boolean;
};

function definitionForCase(organizationId: string, case_: Case): ServicePreparationDefinition | null {
  if (!getRegisteredOrganizationProfile(organizationId).features.servicePreparation) return null;
  return servicePreparationFor(case_.workflowSnapshot?.serviceTypeCode);
}

async function serviceFor(organizationId: string, caseId: string, definition: ServicePreparationDefinition, mode: DataAdapterMode): Promise<ServiceEvent | null> {
  return selectServiceEvent(await listAppointmentsForCase(organizationId, caseId, mode), { organizationId, caseId, appointmentType: definition.serviceAppointmentType });
}

async function documentsFor(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<{ id: string; fileName: string }[]> {
  return (await listCaseDocuments(organizationId, caseId, mode)).filter((d) => d.status === 'active').map((d) => ({ id: d.id, fileName: d.fileName }));
}

/** The case's preparation, or null when it has none (Direct Cremation, Manors, another organization's case). */
export async function getServicePreparation(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<ServicePreparationView | null> {
  const case_ = await loadCaseOnServer(organizationId, caseId, mode);
  if (!case_) return null;
  const definition = definitionForCase(organizationId, case_);
  if (!definition) return null;
  const [service, documents] = await Promise.all([serviceFor(organizationId, caseId, definition, mode), documentsFor(organizationId, caseId, mode)]);
  const record = case_.servicePreparation && case_.servicePreparation.definitionKey === definition.key ? case_.servicePreparation : null;
  return { applies: true, definitionKey: definition.key, record, service, documents, isArchived: case_.isDeleted === true, storageAvailable: servicePreparationStorageAvailable(mode) };
}

export async function changeServicePreparation(
  ctx: ActivityContext,
  caseId: string,
  input: { change: PreparationChange; basis: PreparationChangeBasis; actorName: string | null; reason?: string | null; now?: string; eventId?: string },
  mode: DataAdapterMode,
): Promise<ServicePreparationView> {
  const organizationId = ctx.organizationId;
  const actorId = ctx.actorIdentityId;
  if (!actorId) throw new ServicePreparationError('Sign in to change preparation.', 403);
  if (!servicePreparationStorageAvailable(mode)) throw new ServicePreparationError(SERVICE_PREPARATION_STORAGE_UNAVAILABLE, 503);

  const first = await loadCaseOnServer(organizationId, caseId, mode);
  const definition = first ? definitionForCase(organizationId, first) : null;
  if (!first || !definition) throw new ServicePreparationError('This case has no service preparation.', 404);
  const [service, documents] = await Promise.all([serviceFor(organizationId, caseId, definition, mode), documentsFor(organizationId, caseId, mode)]);
  const { change } = input;
  if (change.kind === 'item' && change.documentId && !documents.some((d) => d.id === change.documentId)) {
    throw new ServicePreparationError('That document is not on this case.', 400);
  }

  const now = input.now ?? new Date().toISOString();
  const eventId = input.eventId ?? crypto.randomUUID();
  // Decided from the case as it is at write time (a retry after a refused
  // conditional write decides again, with the same event id).
  const decide = (current: Case): ServicePreparationRecord => {
    if (current.isDeleted) throw new ServicePreparationError('This case is archived and read-only.', 409);
    if (current.servicePreparationUnreadable) {
      throw new ServicePreparationError("This case's saved preparation could not be read, so nothing was changed (to avoid overwriting it). Please contact SolisCode support.", 409);
    }
    const previous = current.servicePreparation && current.servicePreparation.definitionKey === definition.key ? current.servicePreparation : null;
    return applyPreparationChange({ definition, record: previous, service, change, basis: input.basis, actor: { id: actorId, name: input.actorName }, now, eventId, reason: input.reason ?? null });
  };
  const hasEvent = (case_: Case | null | undefined) => Boolean(case_?.servicePreparation?.history?.some((e) => e.eventId === eventId));

  let saved: Case | null;
  try {
    if (mode === 'mock') {
      saved = writeMockCase(organizationId, caseId, (current) => ({ ...current, servicePreparation: decide(current) }));
    } else {
      let outcome: Awaited<ReturnType<typeof updateCaseWithRetry>> | { result: 'unclear' };
      try {
        outcome = await updateCaseWithRetry(organizationId, caseId, (row) => buildCaseFieldPatch(row.data, { servicePreparation: decide(row.case_) } as CaseUpdate));
      } catch (error) {
        if (isDecisionError(error)) throw error;
        console.error(`Saving preparation for case ${caseId}: no clear answer from Wix:`, error instanceof Error ? error.message : error);
        outcome = { result: 'unclear' };
      }
      if (outcome.result === 'conflict') throw new ServicePreparationError('The case changed while this was being saved. Please try again.', 409);
      if (outcome.result === 'failed' || outcome.result === 'unclear') {
        // Never retried blindly: read the case back; the event id decides.
        const readBack = await loadCaseRow(organizationId, caseId).catch(() => undefined);
        if (readBack === undefined) {
          throw new ServicePreparationError('SOLIS could not confirm whether this change was saved. Refresh the page and check it before trying again.', 503);
        }
        if (!hasEvent(readBack?.case_)) {
          throw new ServicePreparationError('This change was not saved. Please try again.', 503);
        }
        saved = readBack!.case_;
      } else {
        saved = outcome.result === 'not_found' ? null : outcome.case_;
      }
    }
  } catch (error) {
    if (error instanceof PreparationConflictError) {
      throw new ServicePreparationError(error.message, 409, await getServicePreparation(organizationId, caseId, mode));
    }
    if (error instanceof PreparationLimitError) throw new ServicePreparationError(error.message, 413);
    if (error instanceof PreparationChangeError) throw new ServicePreparationError(error.message, 400);
    throw error;
  }
  if (!saved) throw new ServicePreparationError('This case has no service preparation.', 404);

  // The Activity event mirrors the history entry, once, under the same id.
  const entry = saved.servicePreparation?.history?.find((e) => e.eventId === eventId);
  if (entry) {
    try {
      await recordServicePreparationChange(
        { ...ctx, correlationId: eventId },
        caseId,
        {
          description: entry.description,
          target: entry.target.key,
          previous: entry.previous as Record<string, unknown> | null,
          next: entry.next as Record<string, unknown>,
          ...(entry.duringHold ? { reason: entry.reason ?? null, duringHold: true } : {}),
        },
        mode,
      );
    } catch (error) {
      console.error(`Activity event for preparation change ${eventId} on case ${caseId} was not recorded; the change and its history entry are saved on the case:`, error instanceof Error ? error.message : error);
    }
  }

  return {
    applies: true,
    definitionKey: definition.key,
    record: saved.servicePreparation ?? null,
    service,
    documents,
    isArchived: saved.isDeleted === true,
    storageAvailable: true,
  };
}
