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
  | 'pickupReleaseRelationship' // submission/review-only — no existing Case field; see FIELD_MAP_ARRANGEMENT_FORMS' own comment
  // Informant/Legal-NOK block (2026-09 historical-case-creation audit):
  // deliberately review-only, same as pickupReleaseRelationship above.
  // Informant is a DISTINCT concept from Solis's own nextOfKin* Case
  // fields — this form's own section header ("INFORMANT (LEGAL NEXT OF
  // KIN)") conflates the two, but no code path in this codebase may ever
  // treat them as interchangeable. These three exist so Informant data is
  // visible for staff review (reconciliation's "Also submitted" section,
  // and the historical-case-creation preview) — never auto-applied to
  // nextOfKinName/nextOfKinPhone/nextOfKinRelationship.
  | 'informantName'
  | 'informantPhone'
  | 'informantRelationship'
  // Arrangement Forms NOK branch (Phase A.2, 2026-09): the raw submitted
  // answer to qid 276 ("Is the Informant named above also the decedent's
  // Next of Kin?") — 'Yes' | 'No' | any other raw string Jotform ever
  // sends. Review/audit-only, exactly like informantName/Phone/
  // Relationship above — never itself applied to a Case field (there is
  // no Case column for it). It is the one thing that authorizes deriving
  // nextOfKinName/nextOfKinPhone/nextOfKinRelationship from the Informant
  // fields — see arrangementNokDerivation.ts, the only code path allowed
  // to make that derivation.
  | 'informantIsNextOfKin';

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

/** Arrangement Forms — form 261945978664175, canonical form id, named here
    once so every file that needs to gate behavior on "is this Arrangement
    Forms specifically" (arrangementNokDerivation.ts, prefillUrl.ts) shares
    one source of truth rather than repeating the raw literal. */
export const ARRANGEMENT_FORMS_EXTERNAL_FORM_ID = '261945978664175';

/** Vital Statistics — form 262605621454050, canonical form id, named for
    the same reason as ARRANGEMENT_FORMS_EXTERNAL_FORM_ID above (2026-09
    outbound-prefill fix: prefillUrl.ts's "common" decedent-info block was
    previously hardcoded to this form's own qids — 3/10/6/22/24/39 — and
    executed unconditionally for every form, including Arrangement Forms,
    where those same qid numbers either don't exist or belong to an
    unrelated field. See prefillUrl.ts's own comment.) */
export const VITAL_STATISTICS_EXTERNAL_FORM_ID = '262605621454050';

/** Arrangement Forms NOK-branch relationship dropdowns (Phase A.2,
    2026-09) — qid 225 (Informant's Relationship to Deceased) and qid 279
    (Next of Kin Relationship to Deceased) were both confirmed, via a
    direct read-only Jotform API audit, to carry the EXACT SAME option
    list: "Spouse|Mother|Father|Son|Daughter|Sister|Brother|Grandson|
    Granddaughter|Other". This is deliberately a SEPARATE constant from
    NOK_RELATIONSHIP_VALUE_MAP above (Vital Statistics' own qid 38
    dropdown) rather than an extension of it — the two forms' dropdowns
    are confirmed identical only by coincidence today; keeping them
    independent means a future divergence in either form's option list
    can never silently affect the other. Every option maps to an exact,
    real NextOfKinRelationship enum value — no fuzzy matching. */
export const ARRANGEMENT_NOK_RELATIONSHIP_VALUE_MAP: Record<string, NextOfKinRelationship> = {
  Spouse: 'spouse',
  Mother: 'parent',
  Father: 'parent',
  Son: 'son',
  Daughter: 'daughter',
  Sister: 'sister',
  Brother: 'brother',
  Grandson: 'grandchild',
  Granddaughter: 'grandchild',
  Other: 'other',
};

/** The inverse of ARRANGEMENT_NOK_RELATIONSHIP_VALUE_MAP, used only for
    SOLIS -> Jotform prefill (domain/externalForms/prefillUrl.ts) —
    deliberately a STRICT SUBSET, not a full inverse. 'parent' and
    'grandchild' are each produced by two different Jotform options
    (Mother/Father, Grandson/Granddaughter) — reversing either would mean
    guessing which one, which this integration's own "no fuzzy matching"
    principle forbids. Those two enum values are simply never prefilled;
    every other listed value reverses unambiguously to exactly one
    Jotform option. */
export const ARRANGEMENT_NOK_RELATIONSHIP_REVERSE_MAP: Partial<Record<NextOfKinRelationship, string>> = {
  spouse: 'Spouse',
  son: 'Son',
  daughter: 'Daughter',
  sister: 'Sister',
  brother: 'Brother',
  other: 'Other',
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
  // Informant / "10. INFORMANT (LEGAL NEXT OF KIN)" block (qids 122/224/225,
  // confirmed via a read-only form-metadata audit, 2026-09). Review-only —
  // see MappedSolisField's own comment: this must NEVER auto-populate
  // nextOfKinName/nextOfKinPhone/nextOfKinRelationship. informantRelationship
  // intentionally carries no valueMap (unlike nextOfKinRelationship's
  // NOK_RELATIONSHIP_VALUE_MAP) — there is no Case enum destination to
  // conform to; the raw Jotform option text is shown as-is.
  { qid: '122', jotformName: 'name122', solisField: 'informantName', subfield: 'first' },
  { qid: '122', jotformName: 'name122', solisField: 'informantName', subfield: 'last' },
  { qid: '224', jotformName: 'phoneNumber224', solisField: 'informantPhone', subfield: 'full' },
  { qid: '225', jotformName: 'informantsRelationship', solisField: 'informantRelationship' },
  // qids 276-279 (the Yes/No NOK branch question + its 3 dedicated NOK
  // fields, added to the live Jotform in Phase A, 2026-09) are
  // DELIBERATELY ABSENT from this array. They cannot be handled by a
  // plain FieldMapEntry — qid 276's answer decides whether
  // nextOfKinName/Phone/Relationship come from the Informant fields above
  // or from qids 277-279, and a stale value in 277-279 must have zero
  // effect whenever 276=Yes. See arrangementNokDerivation.ts, the only
  // place this conditional derivation happens, reading these 4 qids
  // directly from the raw answer map.
];

export function fieldMapForForm(provider: string, externalFormId: string): FieldMapEntry[] {
  if (provider !== 'jotform') return [];
  if (externalFormId === '262605621454050') return FIELD_MAP_VITAL_STATISTICS;
  if (externalFormId === ARRANGEMENT_FORMS_EXTERNAL_FORM_ID) return FIELD_MAP_ARRANGEMENT_FORMS;
  return [];
}
