import crypto from 'crypto';
import { getRegisteredOrganizationProfile } from '../domain/organization/organizationProfiles';
import { servicePreparationFor } from '../domain/servicePreparation/serviceDefinitions';
import {
  MedicalExaminerApprovalError,
  recordMedicalExaminerApproval,
  type MedicalExaminerApprovalHistoryEntry,
  type MedicalExaminerApprovalInput,
  type MedicalExaminerCremationApproval,
} from '../domain/crematory/medicalExaminerApproval';
import { buildCaseFieldPatch } from '../lib/wixCaseMapper';
import type { DataAdapterMode } from '../lib/env';
import type { Case, CaseUpdate } from '../types/case';
import { recordMedicalExaminerApprovalChange, type ActivityContext } from './activityService';
import { updateCaseWithRetry, writeMockCase } from './caseWriteService';
import { list as listCaseDocuments } from './documentService';
import { loadCaseOnServer } from './serverCaseLoader';

/**
 * Medical examiner cremation approval (Gus Phase 5G, 2026-11) — the one
 * writer of `crematory.medicalExaminerApproval` and its history, through
 * the case's revision-checked, key-merged write (no new Wix field).
 *
 * Only for organizations with `funeralDirectorCredentials` (Gus), on cases
 * whose service holds cremation (Viewing, Final Goodbye). Never inferred
 * from the permit, EDRS ticks or the ME jurisdiction flag.
 *
 * LIVE WIX: saving is OFF (MEDICAL_EXAMINER_APPROVAL_LIVE_SAVING). The
 * `crematory` record is a live field Manors uses in Production; nothing
 * here writes to it on a live site until separately approved.
 */
export const MEDICAL_EXAMINER_APPROVAL_LIVE_SAVING = false;

export class MedicalExaminerApprovalServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type MedicalExaminerApprovalView = { approval: MedicalExaminerCremationApproval | null; history: MedicalExaminerApprovalHistoryEntry[] };

function applies(organizationId: string, case_: Case): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.funeralDirectorCredentials && servicePreparationFor(case_.workflowSnapshot?.serviceTypeCode) !== null;
}

export function medicalExaminerApprovalView(case_: Case): MedicalExaminerApprovalView {
  return { approval: case_.crematory?.medicalExaminerApproval ?? null, history: case_.crematory?.medicalExaminerApprovalHistory ?? [] };
}

export async function recordMedicalExaminerApprovalForCase(
  ctx: ActivityContext,
  caseId: string,
  input: MedicalExaminerApprovalInput & { actorName: string | null; now?: string },
  mode: DataAdapterMode,
): Promise<MedicalExaminerApprovalView> {
  const { organizationId } = ctx;
  const actorId = ctx.actorIdentityId;
  if (!actorId) throw new MedicalExaminerApprovalServiceError('Sign in to record the approval.', 403);
  if (mode !== 'mock' && !MEDICAL_EXAMINER_APPROVAL_LIVE_SAVING) {
    throw new MedicalExaminerApprovalServiceError('Recording the medical examiner approval is not available on this site yet. Nothing was saved.', 503);
  }
  const first = await loadCaseOnServer(organizationId, caseId, mode);
  if (!first || !applies(organizationId, first)) throw new MedicalExaminerApprovalServiceError('This case has no medical examiner approval to record here.', 404);
  if (input.evidenceDocumentId) {
    const documents = await listCaseDocuments(organizationId, caseId, mode);
    if (!documents.some((d) => d.id === input.evidenceDocumentId && d.status === 'active')) {
      throw new MedicalExaminerApprovalServiceError('That document is not on this case.', 400);
    }
  }
  const now = input.now ?? new Date().toISOString();
  const eventId = crypto.randomUUID();
  let entry: MedicalExaminerApprovalHistoryEntry | null = null;
  const decide = (current: Case) => {
    if (current.isDeleted) throw new MedicalExaminerApprovalServiceError('This case is archived and read-only.', 409);
    const result = recordMedicalExaminerApproval({ input, current: current.crematory?.medicalExaminerApproval ?? null, dateOfDeath: current.dateOfDeath, actor: { id: actorId, name: input.actorName }, now, eventId });
    entry = result.entry;
    return { medicalExaminerApproval: result.approval, medicalExaminerApprovalHistory: [...(current.crematory?.medicalExaminerApprovalHistory ?? []), result.entry] };
  };

  let saved: Case | null;
  try {
    if (mode === 'mock') {
      saved = writeMockCase(organizationId, caseId, (current) => ({ ...current, crematory: { ...(current.crematory ?? {}), ...decide(current) } }));
    } else {
      const outcome = await updateCaseWithRetry(organizationId, caseId, (row) => buildCaseFieldPatch(row.data, { crematory: decide(row.case_) } as CaseUpdate));
      if (outcome.result === 'conflict') throw new MedicalExaminerApprovalServiceError('The case changed while this was being saved. Please try again.', 409);
      if (outcome.result === 'failed') throw new MedicalExaminerApprovalServiceError('SOLIS could not confirm whether this was saved. Refresh the page and check before trying again.', 503);
      saved = outcome.result === 'not_found' ? null : outcome.case_;
    }
  } catch (error) {
    if (error instanceof MedicalExaminerApprovalError) throw new MedicalExaminerApprovalServiceError(error.message, 400);
    throw error;
  }
  if (!saved || !entry) throw new MedicalExaminerApprovalServiceError('Case not found.', 404);

  const recorded = entry as MedicalExaminerApprovalHistoryEntry;
  try {
    await recordMedicalExaminerApprovalChange(
      { ...ctx, correlationId: eventId },
      caseId,
      {
        description: `Medical examiner cremation approval ${recorded.action} (${recorded.next.approvalDate}, ref. ${recorded.next.reference})${recorded.reason ? ` — ${recorded.reason}` : ''}`,
        previous: recorded.previous as Record<string, unknown> | null,
        next: recorded.next as unknown as Record<string, unknown>,
      },
      mode,
    );
  } catch (error) {
    console.error(`Activity event for ME approval ${eventId} on case ${caseId} was not recorded; the approval and its history entry are saved:`, error instanceof Error ? error.message : error);
  }
  return medicalExaminerApprovalView(saved);
}
