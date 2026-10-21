/**
 * SLA tracking (2026-10). See domain/sla/ for the rules.
 *
 * An SLA milestone measures one hand-off — case received to EDRS entry,
 * EDRS to doctor attestation, and so on — independently of the six-step
 * workflow stage. Milestones start and stop on recorded events only; a
 * missing date is shown as missing, never invented.
 */

/** Events SOLIS cannot see for itself, recorded by staff (with an audit
    trail) or by SOLIS where it does know: the case's creation, a received
    Vital Statistics form. Checklist-backed events (EDRS submitted, Hard
    Save, sent to crematory) may also be recorded here when the time
    matters and the checklist tick happened earlier. */
export const SLA_EVENT_KEYS = [
  'case_received',
  'vital_statistics_received',
  'edrs_submitted',
  'attestation_received',
  'hard_saved',
  'submitted_for_approval',
  'approval_received',
  'permit_sent',
  'sent_to_crematory',
  'crematory_received',
  'cremains_ready',
] as const;
export type SlaEventKey = (typeof SLA_EVENT_KEYS)[number];

export type SlaEventRecord = {
  /** When it happened (ISO-8601), as recorded. */
  at: string;
  /** When it was recorded, and by whom (null: SOLIS itself). */
  recordedAt: string;
  recordedBy: string | null;
  source: 'staff' | 'automatic';
};

export const SLA_MILESTONE_KEYS = [
  'edrs_entry',
  'doctor_attestation',
  'hard_save',
  'approval',
  'crematory_turnaround',
  'family_pickup',
] as const;
export type SlaMilestoneKey = (typeof SLA_MILESTONE_KEYS)[number];

export type SlaResponsibleParty = 'staff' | 'family' | 'doctor' | 'medical_examiner' | 'state' | 'crematory' | 'other';

export const SLA_DELAY_REASONS = [
  'waiting_on_family',
  'waiting_on_doctor',
  'medical_examiner',
  'crematory_delay',
  'equipment_issue',
  'family_vacation',
  'other',
] as const;
export type SlaDelayReason = (typeof SLA_DELAY_REASONS)[number];

/**
 * A delay recorded against a milestone. Never deleted: a change records a
 * new delay and resolves the previous one, so the full history stays.
 * Recording a delay never moves a deadline or clears an overdue state.
 */
export type SlaDelayRecord = {
  id: string;
  milestone: SlaMilestoneKey;
  reason: SlaDelayReason;
  responsibleParty: SlaResponsibleParty;
  notes: string | null;
  /** YYYY-MM-DD, optional. */
  expectedResolutionDate: string | null;
  recordedAt: string;
  recordedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** 'resolved' by staff, or 'superseded' by a newer delay on the same milestone. */
  resolution: 'resolved' | 'superseded' | null;
};

export type SlaStatus =
  | 'on_track'
  | 'due_soon'
  | 'due_today'
  | 'overdue'
  | 'waiting_on_others'
  | 'exception_acknowledged'
  | 'completed'
  | 'start_date_needed';
