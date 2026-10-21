import { NOTIFICATION_TYPES, type NotificationTypeKey } from './notificationTypeRegistry';

/**
 * Per-notification-type defaults, and how an individual choice combines
 * with the broader ones (2026-10).
 *
 * The category preferences that already existed could not express "tell me
 * when a PDF import FAILS but not when it succeeds" — both are the
 * `document` category, so turning one off took the other with it. That is
 * the gap this closes: a single switch per event, on top of the category
 * and global switches rather than replacing them.
 *
 * Only types with a WIRED trigger appear here. An event SOLIS cannot yet
 * emit must not be offered as a setting somebody can turn on and then wait
 * for — see IMPLEMENTED_NOTIFICATION_TYPES, which the Settings page reads.
 */

/**
 * Whether a type is on for someone who has never expressed a preference.
 *
 * The shape of the choices: routine successes that staff already witness
 * are OFF, and the failures they would otherwise discover days later are
 * ON. A PDF that imported is visible on the case; a PDF that did not is
 * invisible until a family asks for it.
 */
export const DEFAULT_TYPE_ENABLED: Readonly<Record<string, boolean>> = {
  // Case management — the day's real work.
  [NOTIFICATION_TYPES.CASE_CREATED.key]: true,
  [NOTIFICATION_TYPES.CASE_ARRANGEMENT_RECEIVED.key]: true,
  [NOTIFICATION_TYPES.CASE_VITAL_STATISTICS_RECEIVED.key]: true,
  [NOTIFICATION_TYPES.CASE_COMPLETED.key]: true,
  [NOTIFICATION_TYPES.INTAKE_SUBMISSION_NEEDS_ATTENTION.key]: true,

  // Deadlines (SLA) — the alerts exist to stop work stalling.
  [NOTIFICATION_TYPES.CASE_SLA_HARD_SAVE_DUE.key]: true,
  [NOTIFICATION_TYPES.CASE_SLA_DUE.key]: true,
  [NOTIFICATION_TYPES.CASE_SLA_OVERDUE.key]: true,
  [NOTIFICATION_TYPES.CASE_SLA_EXTERNAL_OVERDUE.key]: true,

  // Documents — successes are routine, failures are not.
  [NOTIFICATION_TYPES.JOTFORM_PDF_IMPORTED.key]: false,
  [NOTIFICATION_TYPES.JOTFORM_PDF_IMPORT_FAILED.key]: true,
  [NOTIFICATION_TYPES.DOCUMENT_GENERATED.key]: false,
  [NOTIFICATION_TYPES.DOCUMENT_GENERATION_FAILED.key]: true,

  // Money — both directions matter.
  [NOTIFICATION_TYPES.PAYMENT_RECEIVED.key]: true,
  [NOTIFICATION_TYPES.PAYMENT_FAILED.key]: true,
};

/** The types the Settings page offers, grouped as staff think about them.
    Everything here has a wired trigger. */
export const NOTIFICATION_PREFERENCE_GROUPS: readonly {
  label: string;
  types: readonly { key: NotificationTypeKey; label: string; description: string }[];
}[] = [
  {
    label: 'Case Management',
    types: [
      { key: NOTIFICATION_TYPES.CASE_CREATED.key, label: 'New Case Created', description: 'Receive an alert when a new case is created.' },
      {
        key: NOTIFICATION_TYPES.CASE_ARRANGEMENT_RECEIVED.key,
        label: 'Arrangement Form Received',
        description: 'Receive an alert when a Cremation Arrangement Form arrives for an existing case.',
      },
      {
        key: NOTIFICATION_TYPES.CASE_VITAL_STATISTICS_RECEIVED.key,
        label: 'Vital Statistics Received',
        description: 'Receive an alert when a Vital Statistics Form updates a case.',
      },
      {
        key: NOTIFICATION_TYPES.CASE_COMPLETED.key,
        label: 'Case Completed',
        description: 'Receive an alert when a case finishes all of its required steps.',
      },
      {
        key: NOTIFICATION_TYPES.INTAKE_SUBMISSION_NEEDS_ATTENTION.key,
        label: 'Submission Requires Attention',
        description: 'Receive an alert when a form submission needs someone to resolve it by hand.',
      },
    ],
  },
  {
    label: 'Deadlines (SLA)',
    types: [
      { key: NOTIFICATION_TYPES.CASE_SLA_HARD_SAVE_DUE.key, label: 'Hard Save Due', description: "Receive an alert when a doctor's attestation arrives and the Hard Save becomes due." },
      { key: NOTIFICATION_TYPES.CASE_SLA_DUE.key, label: 'Deadline Approaching', description: 'Receive an alert when a staff deadline is due soon or due today.' },
      { key: NOTIFICATION_TYPES.CASE_SLA_OVERDUE.key, label: 'Deadline Overdue', description: 'Receive an alert when a staff deadline is missed.' },
      { key: NOTIFICATION_TYPES.CASE_SLA_EXTERNAL_OVERDUE.key, label: 'Waiting Past Target', description: 'Receive an alert when a doctor, the state or the crematory is past its target.' },
    ],
  },
  {
    label: 'Documents',
    types: [
      {
        key: NOTIFICATION_TYPES.JOTFORM_PDF_IMPORTED.key,
        label: 'Form PDF Imported',
        description: 'Receive an alert when a form PDF is attached to a case.',
      },
      {
        key: NOTIFICATION_TYPES.JOTFORM_PDF_IMPORT_FAILED.key,
        label: 'Form PDF Import Failed',
        description: 'Receive an alert when a form PDF cannot be attached to a case.',
      },
      {
        key: NOTIFICATION_TYPES.DOCUMENT_GENERATED.key,
        label: 'Document Generated',
        description: 'Receive an alert when a case document is successfully generated.',
      },
      {
        key: NOTIFICATION_TYPES.DOCUMENT_GENERATION_FAILED.key,
        label: 'Document Generation Failed',
        description: 'Receive an alert when a case document fails to generate.',
      },
    ],
  },
  {
    label: 'Payments',
    types: [
      {
        key: NOTIFICATION_TYPES.PAYMENT_RECEIVED.key,
        label: 'Payment Received',
        description: 'Receive an alert when a payment is recorded.',
      },
      {
        key: NOTIFICATION_TYPES.PAYMENT_FAILED.key,
        label: 'Payment Requires Attention',
        description: 'Receive an alert when a payment could not be completed.',
      },
    ],
  },
];

/** Every type the Settings page offers — the allow-list a preference write
    is validated against, so an unimplemented type cannot be stored. */
export const IMPLEMENTED_NOTIFICATION_TYPES: readonly string[] = NOTIFICATION_PREFERENCE_GROUPS.flatMap((g) =>
  g.types.map((t) => t.key),
);

/**
 * Whether this recipient wants this specific type, before any category or
 * global switch is considered.
 *
 * An absent entry means the person has never said — so the default above
 * applies, and an existing preference row written before individual
 * controls existed keeps behaving exactly as it did.
 */
export function isTypeEnabled(typeOverrides: Readonly<Record<string, boolean>>, notificationType: string): boolean {
  const explicit = typeOverrides[notificationType];
  if (explicit !== undefined) return explicit;
  // A type with no default here is one of the older categories (tasks,
  // scheduling, system). Those have always been governed by the category
  // and global switches alone, and must keep working that way.
  return DEFAULT_TYPE_ENABLED[notificationType] ?? true;
}
