/**
 * Arrangement Forms NOK derivation (Phase A.2, 2026-09). qid 276 ("Is the
 * Informant named above also the decedent's Next of Kin?") is the ONLY
 * thing that may ever authorize deriving Next of Kin identity from the
 * Informant fields — a missing/blank Informant or NOK field is never
 * itself treated as evidence, and no fuzzy/name-comparison logic exists
 * anywhere in this module.
 *
 * Stale-value defense: Jotform's form-wide `clearFieldOnHide` is disabled
 * (left unchanged during Phase A's Jotform-configuration checkpoint — a
 * global, unrelated-fields-affecting toggle was out of scope there). A
 * user who selects "No", types a NOK, then switches to "Yes" before
 * submitting may submit stale values in qids 277-279. `deriveArrangementNextOfKin`
 * discards those completely on the Yes path — their presence must have
 * zero effect on the derived result.
 *
 * Fail-safe by construction: qid 276 missing, blank, or anything other
 * than an exact "Yes"/"No" never derives NOK from Informant, and never
 * trusts qids 277-279 either — there is no human confirmation of which
 * source (if either) is authoritative for that submission.
 */
import { readAnswerValue, type JotformAnswerMap } from './extractMappedFields';
import {
  ARRANGEMENT_NOK_RELATIONSHIP_VALUE_MAP,
  type FieldMapEntry,
  type MappedSolisField,
} from './fieldMapping';
import { legacyLayoutForForm, resolveFormLayout, type ExternalFormLayout, type FormLayoutSubject } from './formRegistry';
import { extractMappedFields } from './extractMappedFields';

const QID_INFORMANT_IS_NOK = '276';
const QID_DEDICATED_NOK_NAME = '277';
const QID_DEDICATED_NOK_PHONE = '278';
const QID_DEDICATED_NOK_RELATIONSHIP = '279';

export type ArrangementNokDerivationInput = {
  informantName: string | null;
  informantPhone: string | null;
  /** Raw Jotform option text (e.g. "Mother") — informantRelationship is
      stored unmapped for review purposes (see fieldMapping.ts), so this
      function is responsible for running it through
      ARRANGEMENT_NOK_RELATIONSHIP_VALUE_MAP before it can ever land in
      the enum-typed nextOfKinRelationship. */
  informantRelationship: string | null;
};

export type ArrangementNokDerivationResult = Partial<
  Record<'nextOfKinName' | 'nextOfKinPhone' | 'nextOfKinRelationship' | 'nextOfKinRelationshipSource' | 'informantIsNextOfKin', string>
>;

function readDedicatedNokName(answers: JotformAnswerMap): string | null {
  const first = readAnswerValue(answers, QID_DEDICATED_NOK_NAME, 'first');
  const last = readAnswerValue(answers, QID_DEDICATED_NOK_NAME, 'last');
  if (!first && !last) return null;
  return [first, last].filter(Boolean).join(' ');
}

/**
 * Pure, deterministic, independently unit-testable. Never touches a Case,
 * never persists anything — mirrors extractMappedFields.ts's own
 * pure-function contract exactly.
 */
export function deriveArrangementNextOfKin(
  answers: JotformAnswerMap,
  informant: ArrangementNokDerivationInput,
): ArrangementNokDerivationResult {
  const rawBranchAnswer = readAnswerValue(answers, QID_INFORMANT_IS_NOK);
  const result: ArrangementNokDerivationResult = {};
  if (rawBranchAnswer !== null) result.informantIsNextOfKin = rawBranchAnswer;

  if (rawBranchAnswer === 'Yes') {
    // Authoritative: derive NOK from Informant. qids 277-279 are NEVER
    // read on this path — their presence (even stale values left over
    // from an earlier "No" selection) has zero effect.
    if (informant.informantName) result.nextOfKinName = informant.informantName;
    if (informant.informantPhone) result.nextOfKinPhone = informant.informantPhone;
    if (informant.informantRelationship) {
      // The submitted text is always kept; only an exact option match
      // becomes the SOLIS relationship.
      result.nextOfKinRelationshipSource = informant.informantRelationship;
      const relationship = ARRANGEMENT_NOK_RELATIONSHIP_VALUE_MAP[informant.informantRelationship] ?? null;
      if (relationship) result.nextOfKinRelationship = relationship;
    }
    return result;
  }

  if (rawBranchAnswer === 'No') {
    const name = readDedicatedNokName(answers);
    const phone = readAnswerValue(answers, QID_DEDICATED_NOK_PHONE, 'full');
    const relationshipRaw = readAnswerValue(answers, QID_DEDICATED_NOK_RELATIONSHIP);
    const relationship = relationshipRaw ? (ARRANGEMENT_NOK_RELATIONSHIP_VALUE_MAP[relationshipRaw] ?? null) : null;
    if (name) result.nextOfKinName = name;
    if (phone) result.nextOfKinPhone = phone;
    if (relationshipRaw) result.nextOfKinRelationshipSource = relationshipRaw;
    if (relationship) result.nextOfKinRelationship = relationship;
    return result;
  }

  // Missing, blank, or anything other than an exact "Yes"/"No" — fail
  // safe. Never derive from Informant; never trust the dedicated fields
  // either.
  return result;
}

/**
 * Composes the ordinary FieldMapEntry-driven extraction (informantName/
 * Phone/Relationship, plus every other Arrangement Forms mapping) with
 * the NOK derivation above. The derivation's nextOfKinName/Phone/
 * Relationship ALWAYS win — this is what makes stale qid 277-279 values
 * inert on the Yes path, and what makes a missing/malformed qid 276
 * suppress any nextOfKinName/Phone/Relationship value entirely (fail
 * safe, never "manufacture NOK identity" from raw extraction alone).
 */
export function extractArrangementFormsMappedFields(
  fieldMap: FieldMapEntry[],
  answers: JotformAnswerMap,
): Partial<Record<MappedSolisField, string>> {
  const base = extractMappedFields(fieldMap, answers);
  const derived = deriveArrangementNextOfKin(answers, {
    informantName: base.informantName ?? null,
    informantPhone: base.informantPhone ?? null,
    informantRelationship: base.informantRelationship ?? null,
  });

  const result: Partial<Record<MappedSolisField, string>> = { ...base };
  delete result.nextOfKinName;
  delete result.nextOfKinPhone;
  delete result.nextOfKinRelationship;
  delete result.informantIsNextOfKin;
  delete result.nextOfKinRelationshipSource;
  if (derived.nextOfKinName) result.nextOfKinName = derived.nextOfKinName;
  if (derived.nextOfKinPhone) result.nextOfKinPhone = derived.nextOfKinPhone;
  if (derived.nextOfKinRelationship) result.nextOfKinRelationship = derived.nextOfKinRelationship;
  if (derived.informantIsNextOfKin) result.informantIsNextOfKin = derived.informantIsNextOfKin;
  if (derived.nextOfKinRelationshipSource) result.nextOfKinRelationshipSource = derived.nextOfKinRelationshipSource;
  return result;
}

/**
 * Single entry point every caller (webhook + both historical importers)
 * should use in place of a bare `extractMappedFields(fieldMapForForm(...))`
 * call — guarantees the Arrangement-specific NOK derivation is applied
 * everywhere this integration computes mappedFields, never only in some
 * call sites. Every other form (Vital Statistics) is completely
 * unaffected — this falls straight through to the exact same
 * extractMappedFields call it always used.
 */
export function extractMappedFieldsForForm(
  config: FormLayoutSubject,
  answers: JotformAnswerMap,
): Partial<Record<MappedSolisField, string>>;
/** @deprecated organization-blind legacy form; pass the trusted config. */
export function extractMappedFieldsForForm(
  provider: string,
  externalFormId: string,
  answers: JotformAnswerMap,
): Partial<Record<MappedSolisField, string>>;
/**
 * Multi-tenant hardening (2026-10): the preferred form takes the TRUSTED
 * server-side config, so the layout is resolved per organization through
 * domain/externalForms/formRegistry.ts — a config whose organization has
 * no registered layout gets generic handling (nothing mapped), never
 * another organization's mapping. The (provider, externalFormId) form is
 * kept for older callers/tests and resolves registered bindings only.
 */
export function extractMappedFieldsForForm(
  configOrProvider: FormLayoutSubject | string,
  externalFormIdOrAnswers: string | JotformAnswerMap,
  maybeAnswers?: JotformAnswerMap,
): Partial<Record<MappedSolisField, string>> {
  let layout: ExternalFormLayout | null;
  let answers: JotformAnswerMap;
  if (typeof configOrProvider === 'string') {
    layout = legacyLayoutForForm(configOrProvider, externalFormIdOrAnswers as string);
    answers = maybeAnswers ?? {};
  } else {
    layout = resolveFormLayout(configOrProvider);
    answers = externalFormIdOrAnswers as JotformAnswerMap;
  }
  const fieldMap = [...(layout?.fieldMap ?? [])];
  if (layout?.extraction === 'arrangement_nok_derivation') {
    return extractArrangementFormsMappedFields(fieldMap, answers);
  }
  return extractMappedFields(fieldMap, answers);
}
