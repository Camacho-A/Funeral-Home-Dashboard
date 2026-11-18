/**
 * Medical examiner cremation approval (Gus Phase 5G, 2026-11).
 *
 * Florida requires the medical examiner's approval for every cremation
 * (§406.11(1)(c)); funeral homes request it through EDRS. SOLIS records it
 * ONLY when staff confirm it in EDRS and record it here — it is never
 * inferred from the state permit, from EDRS checklist ticks, or from the
 * "Medical Examiner case" (jurisdiction) flag.
 *
 * Stored in the case's existing `crematory` record (no new Wix field):
 * `medicalExaminerApproval` (the current one) and
 * `medicalExaminerApprovalHistory` (append-only — a correction adds an
 * entry with its reason; nothing is ever removed).
 */
export type MedicalExaminerCremationApproval = {
  confirmedInEdrs: true;
  /** YYYY-MM-DD, as shown in EDRS. */
  approvalDate: string;
  /** The EDRS or medical examiner reference for the approval. */
  reference: string;
  /** What the confirmation rests on: a document on the case (e.g. a saved
      EDRS screen), and/or where it was verified. At least one. */
  evidence: { documentId: string | null; source: string | null };
  recordedBy: string;
  recordedByName: string | null;
  /** Server time. */
  recordedAt: string;
  eventId: string;
};

export type MedicalExaminerApprovalHistoryEntry = {
  eventId: string;
  action: 'recorded' | 'corrected';
  reason: string | null;
  previous: MedicalExaminerCremationApproval | null;
  next: MedicalExaminerCremationApproval;
  actorId: string;
  actorName: string | null;
  at: string;
};

export type MedicalExaminerApprovalInput = {
  confirmedInEdrs: boolean;
  approvalDate: string;
  reference: string;
  evidenceDocumentId: string | null;
  evidenceSource: string | null;
  /** Required when replacing an approval already on the case. */
  reason?: string | null;
};

export class MedicalExaminerApprovalError extends Error {}

const TEXT_MAX = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** MM/DD/YYYY (the case's date of death) → YYYY-MM-DD, or null. */
function caseDateToIso(value: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value?.trim() ?? '');
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

function validDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Is this a complete, plausible recorded approval for this case? */
export function checkMedicalExaminerApproval(
  approval: MedicalExaminerCremationApproval | null | undefined,
  params: { dateOfDeath: string | null | undefined; today: string },
): { valid: boolean; problems: string[] } {
  if (!approval) return { valid: false, problems: ['No medical examiner cremation approval has been recorded.'] };
  const problems: string[] = [];
  if (approval.confirmedInEdrs !== true) problems.push('The approval was not confirmed in EDRS.');
  if (!validDate(approval.approvalDate)) problems.push('Approval date is missing or invalid.');
  else {
    if (approval.approvalDate > params.today) problems.push('Approval date is in the future.');
    const death = caseDateToIso(params.dateOfDeath);
    if (death && approval.approvalDate < death) problems.push('Approval date is before the date of death.');
  }
  if (!approval.reference?.trim()) problems.push('EDRS or medical examiner reference is missing.');
  if (!approval.evidence?.documentId && !approval.evidence?.source?.trim()) problems.push('No supporting evidence or verification source.');
  if (!approval.recordedBy || Number.isNaN(Date.parse(approval.recordedAt))) problems.push('Who recorded it, or when, is missing.');
  return { valid: problems.length === 0, problems };
}

const clean = (text: string | null | undefined) => (text?.trim() ? text.trim().slice(0, TEXT_MAX) : null);

/** Validates an input and returns the new approval plus its history entry. */
export function recordMedicalExaminerApproval(params: {
  input: MedicalExaminerApprovalInput;
  current: MedicalExaminerCremationApproval | null;
  dateOfDeath: string | null | undefined;
  actor: { id: string; name: string | null };
  now: string;
  eventId: string;
}): { approval: MedicalExaminerCremationApproval; entry: MedicalExaminerApprovalHistoryEntry } {
  const { input } = params;
  if (input.confirmedInEdrs !== true) throw new MedicalExaminerApprovalError('Confirm that you saw the approval in EDRS.');
  const reason = clean(input.reason);
  if (params.current && !reason) throw new MedicalExaminerApprovalError('An approval is already recorded. Give a reason for correcting it.');
  const approval: MedicalExaminerCremationApproval = {
    confirmedInEdrs: true,
    approvalDate: input.approvalDate.trim(),
    reference: clean(input.reference) ?? '',
    evidence: { documentId: input.evidenceDocumentId || null, source: clean(input.evidenceSource) },
    recordedBy: params.actor.id,
    recordedByName: params.actor.name,
    recordedAt: params.now,
    eventId: params.eventId,
  };
  const check = checkMedicalExaminerApproval(approval, { dateOfDeath: params.dateOfDeath, today: params.now.slice(0, 10) });
  if (!check.valid) throw new MedicalExaminerApprovalError(check.problems.join(' '));
  return {
    approval,
    entry: { eventId: params.eventId, action: params.current ? 'corrected' : 'recorded', reason, previous: params.current, next: approval, actorId: params.actor.id, actorName: params.actor.name, at: params.now },
  };
}
