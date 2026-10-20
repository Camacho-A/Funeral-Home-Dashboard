import type { DataAdapterMode } from '../lib/env';
import type { ExternalFormConfig } from '../types/externalFormConfig';
import type { ExternalFormSubmission } from '../types/externalFormSubmission';
import type { MappedSolisField } from '../domain/externalForms/fieldMapping';
import type { DuplicateCandidate } from '../domain/externalForms/duplicateCandidates';
import {
  decideExistingCaseAttachment,
  soleAttachableCandidate,
  type ExistingCaseAttachmentDecision,
} from '../domain/externalForms/existingCaseAttachment';
import type { ActivityContext } from './activityService';
import { recordExternalFormSubmissionAutoAttached } from './activityService';
import { loadCaseOnServer } from './serverCaseLoader';
import * as caseFormLinkService from './caseFormLinkService';
import * as externalFormSubmissionService from './externalFormSubmissionService';

export type ExistingCaseAttachmentOutcome =
  | { attached: true; caseId: string; submission: ExternalFormSubmission; dateOfBirthDiffers: boolean }
  | { attached: false; reason: Extract<ExistingCaseAttachmentDecision, { attach: false }>['reason'] };

/**
 * Attaches a held `case_create` submission to the single existing case it
 * matched, when domain/externalForms/existingCaseAttachment.ts says that
 * is safe. Uses the same writes as Case → Forms → Import
 * (`linkExistingSubmission` + `markLinked`), so the result is
 * indistinguishable from a staff import apart from its activity entry.
 *
 * The case is read scoped to the submission's own organization, so a
 * candidate can never resolve to another tenant's case.
 */
export async function attachToExistingCase(
  params: {
    config: ExternalFormConfig;
    submission: ExternalFormSubmission;
    mappedFields: Partial<Record<MappedSolisField, string>>;
    candidates: readonly DuplicateCandidate[];
  },
  activityCtx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<ExistingCaseAttachmentOutcome> {
  const { config, submission, mappedFields, candidates } = params;

  // Decide what can be decided before reading anything.
  const sole = soleAttachableCandidate(candidates);
  if ('refusal' in sole) return { attached: false, reason: sole.refusal };

  const caseId = sole.candidate.caseId;
  const [existingCase, caseLinks] = await Promise.all([
    loadCaseOnServer(config.organizationId, caseId, dataAdapterMode),
    caseFormLinkService.listForCase(config.organizationId, caseId, dataAdapterMode),
  ]);
  const decision = decideExistingCaseAttachment({
    candidates,
    mappedFields,
    existingCase,
    caseLinks,
    formConfigId: config.id,
  });
  if (!decision.attach) return { attached: false, reason: decision.reason };

  const link = await caseFormLinkService.linkExistingSubmission(
    config.organizationId,
    decision.caseId,
    config.provider,
    config.id,
    submission.id,
    dataAdapterMode,
  );
  const linked = await externalFormSubmissionService.markLinked(submission.id, link.id, dataAdapterMode);

  try {
    await recordExternalFormSubmissionAutoAttached(
      activityCtx,
      decision.caseId,
      submission.id,
      config.label,
      decision.dateOfBirthDiffers,
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record the automatic form attachment:', error instanceof Error ? error.message : error);
  }

  return {
    attached: true,
    caseId: decision.caseId,
    submission: linked ?? submission,
    dateOfBirthDiffers: decision.dateOfBirthDiffers,
  };
}
