/**
 * Manors Jotform integration (case-first architecture, 2026-09). The
 * ACTUAL field definitions for the two real Manors forms, discovered via
 * a read-only Jotform API audit (never guessed) — see that audit's own
 * report for the full field inventory both forms carry.
 *
 * Every entry is keyed by Jotform's own `qid` — the one stable identifier
 * confirmed directly from the API for every field, rather than the
 * derived `{qid}_{name}` URL-prefill parameter name, which is
 * reconstructed on demand (see domain/externalForms/prefillUrl.ts) from
 * the `jotformName` carried here.
 *
 * Deliberately excludes (per the approved mapping decisions): SSN,
 * signatures, race, education, origin/ethnicity, employment history,
 * parents' names (only Mother/Father *relationship-dropdown values* are
 * remapped — see NOK_RELATIONSHIP_VALUE_MAP below — not the separate
 * "Father's/Mother's Full Name" fields, which stay unmapped), resident/
 * mailing addresses, the Informant/Legal-NOK block, and the DC
 * Requisition family-contact block — all of these remain submission/
 * review-only data, per the explicit "do NOT silently map" list.
 */
import type { NextOfKinRelationship } from '@/types/case';

export type MappedSolisField =
  | 'decedentName'
  | 'dateOfBirth'
  | 'dateOfDeath'
  | 'placeOfDeath'
  | 'isVeteran'
  | 'nextOfKinName'
  | 'nextOfKinRelationship'
  | 'nextOfKinPhone'
  | 'nextOfKinEmail'
  | 'pickupReleasedTo'
  | 'pickupReleaseRelationship'; // submission/review-only — no existing Case field; see FIELD_MAP_ARRANGEMENT_FORMS' own comment

export type FieldMapEntry = {
  qid: string;
  /** Jotform's own `name` for this field — the other half of the
      `{qid}_{name}` URL-prefill parameter (see prefillUrl.ts). */
  jotformName: string;
  solisField: MappedSolisField;
  /** Set only for compound fields (fullname/phone) — the specific
      sub-key this mapping reads/writes (e.g. 'first'/'last' for a name,
      'full' for a phone). Omitted for simple fields. */
  subfield?: string;
  /** For dropdown/radio fields whose Jotform option values don't map
      1:1 onto Solis's own enum — see NOK_RELATIONSHIP_VALUE_MAP. */
  valueMap?: Record<string, string>;
};

/** Jotform's "Next of Kin Relationship" dropdown includes separate
    "Mother"/"Father" options where Solis's own NextOfKinRelationship enum
    only has a generic 'parent' — confirmed by direct comparison against
    types/case.ts during the field audit. Anything not listed here is
    left unmapped (stored as submission-only data) rather than guessed. */
export const NOK_RELATIONSHIP_VALUE_MAP: Record<string, NextOfKinRelationship> = {
  Spouse: 'spouse',
  Son: 'son',
  Daughter: 'daughter',
  Mother: 'parent',
  Father: 'parent',
};

/** Vital Statistics — form 262605621454050. Every qid below is confirmed
    directly from the Jotform API's /form/{id}/questions response. */
export const FIELD_MAP_VITAL_STATISTICS: FieldMapEntry[] = [
  { qid: '3', jotformName: 'nameof', solisField: 'decedentName', subfield: 'first' },
  { qid: '3', jotformName: 'nameof', solisField: 'decedentName', subfield: 'last' },
  { qid: '10', jotformName: 'dateof10', solisField: 'dateOfBirth' },
  { qid: '6', jotformName: 'dateof', solisField: 'dateOfDeath' },
  { qid: '30', jotformName: 'placeOf', solisField: 'placeOfDeath' },
  { qid: '12', jotformName: 'decedentserved', solisField: 'isVeteran', valueMap: { YES: 'true', NO: 'false' } },
  { qid: '22', jotformName: 'nextof', solisField: 'nextOfKinName', subfield: 'first' },
  { qid: '22', jotformName: 'nextof', solisField: 'nextOfKinName', subfield: 'last' },
  { qid: '38', jotformName: 'nextOf38', solisField: 'nextOfKinRelationship', valueMap: NOK_RELATIONSHIP_VALUE_MAP },
  { qid: '24', jotformName: 'nextOf24', solisField: 'nextOfKinPhone', subfield: 'full' },
  { qid: '39', jotformName: 'nextOf39', solisField: 'nextOfKinEmail' },
];

/** Arrangement Forms — form 261945978664175. Only the fields with a
    genuine existing Solis destination are mapped; the other ~110 fields
    (death-certificate demographic data, signatures, employment/parents'
    history, DC-requisition contact, informant block) intentionally have
    no entry here — they remain submission-only, reviewable but never
    auto-applied to a Case. */
export const FIELD_MAP_ARRANGEMENT_FORMS: FieldMapEntry[] = [
  { qid: '87', jotformName: 'name87', solisField: 'decedentName', subfield: 'first' },
  { qid: '87', jotformName: 'name87', solisField: 'decedentName', subfield: 'last' },
  { qid: '8', jotformName: 'dateOf', solisField: 'dateOfBirth' },
  { qid: '10', jotformName: 'dateOf10', solisField: 'dateOfDeath' },
  { qid: '97', jotformName: 'address97', solisField: 'placeOfDeath' },
  { qid: '115', jotformName: 'wasDecedent', solisField: 'isVeteran', valueMap: { Yes: 'true', No: 'false' } },
  // "Release Cremated Remains to:" + its relationship field — the one
  // genuinely valuable new mapping this form offers, connecting directly
  // to the already-shipped Conditional Shipping/Tracking feature.
  { qid: '174', jotformName: 'releaseCremated', solisField: 'pickupReleasedTo', subfield: 'first' },
  { qid: '174', jotformName: 'releaseCremated', solisField: 'pickupReleasedTo', subfield: 'last' },
  // qid=175 ("Relationship") has no existing Case field to land in — kept
  // here as a named, submission-visible field rather than silently
  // dropped, but never applied to a Case (see MappedSolisField's own
  // comment) — the reconciliation UI surfaces it as read-only context
  // alongside pickupReleasedTo, never as an "Apply"-able row.
  { qid: '175', jotformName: 'relationship175', solisField: 'pickupReleaseRelationship' },
];

export function fieldMapForForm(provider: string, externalFormId: string): FieldMapEntry[] {
  if (provider !== 'jotform') return [];
  if (externalFormId === '262605621454050') return FIELD_MAP_VITAL_STATISTICS;
  if (externalFormId === '261945978664175') return FIELD_MAP_ARRANGEMENT_FORMS;
  return [];
}
