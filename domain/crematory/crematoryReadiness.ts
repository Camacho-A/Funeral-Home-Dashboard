import { toCaseDate } from './crematoryPackage';

/**
 * Send to Crematory (2026-10). What a case still needs before its Crematory
 * Package can be built, and before it can be sent. Pure — the service
 * gathers the facts; this decides. Every requirement is listed with plain
 * wording so staff see exactly what needs attention.
 */
export type CrematoryRequirementKey =
  | 'cremation'
  | 'permit_uploaded'
  | 'permit_verified'
  | 'crematory_form'
  | 'workflow_2'
  | 'ready_date'
  | 'package'
  | 'permission';

export type CrematoryRequirement = { key: CrematoryRequirementKey; label: string; ok: boolean; detail: string | null };

export type CrematoryReadinessInput = {
  caseType: string;
  isArchived: boolean;
  /** Every step of workflow 2 checked; null when the workflow has no stage 2. */
  workflow2Complete: boolean | null;
  /** The latest uploaded state permit (a PDF), if any. */
  permit: { documentId: string; checksumSha256: string; mimeType: string } | null;
  /** The staff confirmation on the case: which permit file was confirmed. */
  permitVerification: { documentId: string; checksumSha256: string } | null;
  arrangementForm: { createdAt: string } | null;
  crematoryForm: { createdAt: string } | null;
  readyDate: {
    /** From the Expected Pickup, for staff to confirm or change. */
    suggested: string | null;
    /** What staff confirmed, and what the Expected Pickup was at the time. */
    confirmed: { date: string; suggestedAtConfirmation: string | null } | null;
  };
  /** The latest saved package, and whether it is exactly what the current
      sources and confirmed date produce. */
  package: { fileName: string; current: boolean } | null;
  canSend: boolean;
};

export type CrematoryReadiness = {
  requirements: CrematoryRequirement[];
  /** Everything a package is built from is in place. */
  readyToBuild: boolean;
  /** …and the saved package is current, and the staff member may send. */
  readyToSend: boolean;
};

export function evaluateCrematoryReadiness(input: CrematoryReadinessInput): CrematoryReadiness {
  const r: CrematoryRequirement[] = [];
  const add = (key: CrematoryRequirementKey, label: string, ok: boolean, detail: string | null = null) => r.push({ key, label, ok, detail: ok ? null : detail });

  add('cremation', 'Cremation case', input.caseType === 'cremation' && !input.isArchived, input.isArchived ? 'This case is archived.' : 'Only cremation cases are sent to the crematory.');

  add('permit_uploaded', 'State permit uploaded', input.permit !== null && input.permit.mimeType === 'application/pdf',
    input.permit ? 'The state permit must be a PDF.' : 'Upload the approved state cremation permit.');

  const verifiedCurrent =
    input.permit !== null &&
    input.permitVerification !== null &&
    input.permitVerification.documentId === input.permit.documentId &&
    input.permitVerification.checksumSha256 === input.permit.checksumSha256;
  add('permit_verified', 'Permit confirmed for this decedent', verifiedCurrent,
    input.permit === null ? 'Upload the permit first.' : input.permitVerification ? 'A different permit was uploaded since it was confirmed. Confirm the new one.' : 'Confirm the uploaded permit is the approved permit for this decedent.');

  const formCurrent = input.crematoryForm !== null && (input.arrangementForm === null || input.crematoryForm.createdAt >= input.arrangementForm.createdAt);
  add('crematory_form', 'Arrangement Form page 3 extracted', formCurrent,
    input.crematoryForm === null
      ? input.arrangementForm
        ? 'Extract the Crematory Form (page 3) from the Arrangement Form.'
        : 'The completed Arrangement Form has not been received yet.'
      : 'A newer Arrangement Form arrived. Extract the Crematory Form again.');

  add('workflow_2', 'Workflow 2 complete', input.workflow2Complete === true,
    input.workflow2Complete === null ? "This case's workflow has no stage 2." : 'Check every step of workflow 2 (EDRS & Doctor / Cause of Death).');

  const confirmed = input.readyDate.confirmed;
  const pickupMoved = confirmed !== null && toCaseDate(confirmed.suggestedAtConfirmation) !== toCaseDate(input.readyDate.suggested);
  add('ready_date', 'Expected ready date confirmed', confirmed !== null && toCaseDate(confirmed.date) !== null && !pickupMoved,
    confirmed === null
      ? 'Enter or confirm the expected cremation ready date.'
      : `The Expected Pickup changed since ${toCaseDate(confirmed.date)} was confirmed. Review the expected ready date.`);

  const readyToBuild = r.every((requirement) => requirement.ok);

  add('package', 'Crematory Package up to date', input.package !== null && input.package.current,
    input.package === null ? 'Build the Crematory Package.' : 'The permit, page 3 or the expected date changed. Review and rebuild the Crematory Package.');
  add('permission', 'Allowed to send documents', input.canSend, 'You do not have permission to send documents to the crematory.');

  return { requirements: r, readyToBuild, readyToSend: r.every((requirement) => requirement.ok) };
}
