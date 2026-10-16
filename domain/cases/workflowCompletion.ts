import type { Case } from '../../types/case';
import { lastDisplayStage, findStageByRawStage } from '../workflow/resolveStages';
import { isTerminalReturnRequirementComplete } from './returnMethod';

/**
 * Automatic archiving (2026-10). The single, canonical answer to "is this
 * case genuinely finished?" — the same question `stageLabel` already
 * answers when it reads "Completed", expressed once so the archiver and
 * the UI can never disagree.
 *
 * NOT a progress percentage. A percentage can reach 100 for reasons that
 * have nothing to do with the family having received the remains, and
 * archiving on that would file a case away while its final obligation was
 * still outstanding. Completion here means two things together:
 *
 *   1. The case is sitting at its own template's LAST stage — read from
 *      the case's frozen `workflowSnapshot`, never a hardcoded stage
 *      number, so an organization with a different template is evaluated
 *      against its own.
 *   2. The terminal return-of-remains requirement is satisfied:
 *      `pickupStatus === 'released'` for pickup, or
 *      `shippingDeliveryStatus === 'delivered'` for shipping.
 *
 * What that deliberately excludes:
 *   - The crematory releasing ashes to the funeral home. That is the
 *     "Ashes picked up (Tue/Fri)" step, several items earlier, and is not
 *     the family receiving them.
 *   - Shipping DISPATCH. A tracking number and a "shipped" status are not
 *     a confirmed delivery.
 *   - `returnMethod: 'undecided'`, which can never be complete — there is
 *     no recorded way the remains were returned at all.
 *
 * A case with no `workflowSnapshot` is never complete: without its own
 * template there is no "last stage" to be at, and guessing one would be
 * the hardcoding this function exists to avoid.
 */
export function isCaseWorkflowComplete(
  case_: Pick<Case, 'rawStage' | 'workflowSnapshot' | 'returnMethod' | 'pickupStatus' | 'shippingDeliveryStatus'>,
): boolean {
  const snapshot = case_.workflowSnapshot;
  if (!snapshot) return false;

  const displayStage = findStageByRawStage(snapshot, case_.rawStage)?.displayStage;
  if (displayStage === undefined) return false;
  if (displayStage !== lastDisplayStage(snapshot)) return false;

  return isTerminalReturnRequirementComplete(case_);
}

/**
 * Whether this update is the moment a case BECOMES complete.
 *
 * Archiving keys off the transition, not the state, and that is what
 * makes restoring safe: a case that staff deliberately restore is still
 * complete, so `before` is already true and no later edit re-archives it.
 * Only a genuine incomplete → complete transition can archive, which also
 * means deploying this feature never backfills a single existing case.
 */
export function becameComplete(
  before: Parameters<typeof isCaseWorkflowComplete>[0],
  after: Parameters<typeof isCaseWorkflowComplete>[0],
): boolean {
  return !isCaseWorkflowComplete(before) && isCaseWorkflowComplete(after);
}

/**
 * The patch fields that can change whether a stage is complete, and so
 * must trigger workflow reconciliation (2026-10).
 *
 * Was `checklistState` alone, which was correct when every item was ticked
 * by hand. Items are now also satisfied by the case's own data — the
 * canonical intake columns, certifier, next of kin, payment status — so an
 * ordinary field edit can complete a stage without touching
 * `checklistState` at all. B2026-038 showed the consequence: every intake
 * item read as done and the case still sat on the intake stage, because
 * nothing had triggered reconciliation.
 *
 * Shared by the Wix PATCH route and the mock-mode service so the two can
 * never drift — a divergence here means a fix verified in dev is absent in
 * production, or the reverse.
 */
export const COMPLETION_AFFECTING_FIELDS = [
  'checklistState',
  'fieldValues',
  'paymentStatus',
  'decedentName',
  'dateOfBirth',
  'dateOfDeath',
  'timeOfDeath',
  'placeOfDeath',
  'weight',
  'certifierName',
  'certifierPhone',
  // Template v7's Certifier Information item requires fax (2026-10).
  'certifierFax',
  'nextOfKinName',
  'nextOfKinPhone',
  // Changes WHICH items a stage requires (the Medical Examiner variant
  // swaps the doctor items for verification items), so it can complete or
  // re-open a stage on its own.
  'isMedicalExaminerCase',
] as const;

/** Whether a patch touches anything that can change stage completion. */
export function touchesWorkflowCompletion(patch: object): boolean {
  return COMPLETION_AFFECTING_FIELDS.some((field) => field in patch);
}
