import { getRegisteredOrganizationProfile } from '../domain/organization/organizationProfiles';
import { servicePreparationFor } from '../domain/servicePreparation/serviceDefinitions';
import { selectServiceEvent } from '../domain/servicePreparation/readiness';
import {
  applyPreparationChange,
  currentEntryFor,
  describePreparationChange,
  PreparationChangeError,
  PreparationConflictError,
  type PreparationChange,
  type PreparationChangeBasis,
} from '../domain/servicePreparation/preparationUpdates';
import type { ServiceEvent, ServicePreparationDefinition, ServicePreparationRecord } from '../domain/servicePreparation/types';
import { buildCaseFieldPatch } from '../lib/wixCaseMapper';
import type { DataAdapterMode } from '../lib/env';
import type { Case, CaseUpdate } from '../types/case';
import { recordServicePreparationChange, type ActivityContext } from './activityService';
import { updateCaseWithRetry, writeMockCase } from './caseWriteService';
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
 * LIVE WIX: the `servicePreparation` field is not in the live `cases`
 * collection yet (docs/SERVICE_PREPARATION.md). Until it is added with
 * approval, Wix-mode saves are refused here, so nothing can create the
 * field by writing to it. Reads are safe (absent → no preparation yet).
 */
export const SERVICE_PREPARATION_WIX_FIELD_ADDED = false;

export const SERVICE_PREPARATION_STORAGE_UNAVAILABLE =
  'Saving preparation is not available on this site yet: the case field that stores it has not been added. Nothing was saved.';

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

export function servicePreparationStorageAvailable(mode: DataAdapterMode): boolean {
  return mode === 'mock' || SERVICE_PREPARATION_WIX_FIELD_ADDED;
}

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
  input: { change: PreparationChange; basis: PreparationChangeBasis; actorName: string | null; now?: string },
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
  let previous: ServicePreparationRecord | null = null;
  // Decided from the case as it is at write time (a retry decides again).
  const decide = (current: Case): ServicePreparationRecord => {
    if (current.isDeleted) throw new ServicePreparationError('This case is archived and read-only.', 409);
    previous = current.servicePreparation && current.servicePreparation.definitionKey === definition.key ? current.servicePreparation : null;
    return applyPreparationChange({ definition, record: previous, service, change, basis: input.basis, actor: { id: actorId, name: input.actorName }, now });
  };

  let saved: Case | null;
  try {
    if (mode === 'mock') {
      saved = writeMockCase(organizationId, caseId, (current) => ({ ...current, servicePreparation: decide(current) }));
    } else {
      const outcome = await updateCaseWithRetry(organizationId, caseId, (row) => buildCaseFieldPatch(row.data, { servicePreparation: decide(row.case_) } as CaseUpdate));
      if (outcome.result === 'conflict') throw new ServicePreparationError('The case changed while this was being saved. Please try again.', 409);
      if (outcome.result === 'failed') throw new Error(`Saving preparation for case ${caseId} failed: ${outcome.reason}`);
      saved = outcome.result === 'not_found' ? null : outcome.case_;
    }
  } catch (error) {
    if (error instanceof PreparationConflictError) {
      throw new ServicePreparationError(error.message, 409, await getServicePreparation(organizationId, caseId, mode));
    }
    if (error instanceof PreparationChangeError) throw new ServicePreparationError(error.message, 400);
    throw error;
  }
  if (!saved) throw new ServicePreparationError('This case has no service preparation.', 404);

  const target = change.kind === 'item' ? change.itemId : change.kind === 'choice' ? change.choice : change.key;
  try {
    await recordServicePreparationChange(
      ctx,
      caseId,
      {
        description: describePreparationChange(definition, change),
        target,
        previous: currentEntryFor(previous, change) as Record<string, unknown> | null,
        next: currentEntryFor(saved.servicePreparation ?? null, change) as Record<string, unknown>,
      },
      mode,
    );
  } catch (error) {
    console.error('Failed to record the service preparation activity event:', error instanceof Error ? error.message : error);
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
