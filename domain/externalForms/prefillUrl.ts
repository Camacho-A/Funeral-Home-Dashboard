/**
 * Manors Jotform integration (case-first architecture, 2026-09). Builds a
 * Jotform prefill URL using the exact `{qid}_{name}` (simple) /
 * `{qid}_{name}[{subfield}]` (compound) parameter convention confirmed
 * against the real form field definitions during the read-only Jotform
 * API audit. Never includes the raw link token anywhere but the one
 * hidden field parameter; never includes internal-only data on a
 * family-audience form.
 */
import type { ExternalFormConfig } from '@/types/externalFormConfig';
import type { NextOfKinRelationship } from '@/types/case';
import { ARRANGEMENT_FORMS_EXTERNAL_FORM_ID, VITAL_STATISTICS_EXTERNAL_FORM_ID, ARRANGEMENT_NOK_RELATIONSHIP_REVERSE_MAP } from './fieldMapping';

export type PrefillableCaseValues = {
  caseNumber: string;
  decedentName: string | null;
  dateOfBirth: string | null; // MM/DD/YYYY, matches Case's own stored format
  dateOfDeath: string | null;
  nextOfKinName: string | null;
  nextOfKinPhone: string | null;
  nextOfKinEmail: string | null;
  /** Phase A.2 (2026-09) — used only for Arrangement Forms' dedicated
      qid 279 dropdown (see below). 'parent'/'grandchild' are deliberately
      never prefilled (ARRANGEMENT_NOK_RELATIONSHIP_REVERSE_MAP's own
      comment) — each maps back to two different Jotform options, and
      guessing which one would violate this integration's own "no fuzzy
      matching" principle. */
  nextOfKinRelationship: NextOfKinRelationship | null;
};

/** Naive "last word is the last name" split — matches how this data is
    already entered into Solis as a single field; good enough for a
    convenience prefill a person can still edit before submitting. */
function splitName(fullName: string | null): { first: string; last: string } {
  if (!fullName || !fullName.trim()) return { first: '', last: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/** Prefill-only targets — values Solis sends TO the form but never reads
    back FROM a submission (case number is display/reference only, never
    the authoritative linkage — see the opaque token instead). Distinct
    from domain/externalForms/fieldMapping.ts's reconciliation field map. */
const CASE_NUMBER_QIDS: Record<string, string[]> = {
  // Arrangement Forms carries the case number in two separate fields.
  '261945978664175': [
    'caseNo', // qid=1
    'caseNo198', // qid=198
  ],
};

function appendParam(params: URLSearchParams, qid: string, jotformName: string, subfield: string | undefined, value: string) {
  if (!value) return;
  const key = subfield ? `${qid}_${jotformName}[${subfield}]` : `${qid}_${jotformName}`;
  params.set(key, value);
}

export function buildJotformPrefillUrl(config: ExternalFormConfig, values: PrefillableCaseValues, rawLinkToken: string): string {
  const params = new URLSearchParams();
  const decedent = splitName(values.decedentName);
  const nok = splitName(values.nextOfKinName);

  // Vital Statistics only (2026-09 outbound-prefill fix). This block used
  // to run unconditionally for every form. A historical-import
  // investigation against a real Arrangement Forms submission found that
  // qids 3, 6, 22, 24, 39 either don't exist at all on Arrangement Forms,
  // or (qid 10) belong to a completely different field there (Arrangement's
  // own Date of Death, not Date of Birth) — so this block must only ever
  // run for the one form these qids actually belong to.
  if (config.externalFormId === VITAL_STATISTICS_EXTERNAL_FORM_ID) {
    appendParam(params, '3', 'nameof', 'first', decedent.first);
    appendParam(params, '3', 'nameof', 'last', decedent.last);
    if (values.dateOfBirth) params.set('10_dateof10', values.dateOfBirth);
    if (values.dateOfDeath) params.set('6_dateof', values.dateOfDeath);
    appendParam(params, '22', 'nextof', 'first', nok.first);
    appendParam(params, '22', 'nextof', 'last', nok.last);
    if (values.nextOfKinPhone) appendParam(params, '24', 'nextOf24', 'full', values.nextOfKinPhone);
    if (values.nextOfKinEmail) params.set('39_nextOf39', values.nextOfKinEmail);
  }

  // Arrangement Forms only — its own, genuinely different decedent-info
  // qids, confirmed against a real submission: Name (87), DOB (8), DOD
  // (10 — a coincidental collision with Vital Statistics' own qid 10,
  // which means Date of BIRTH there; the two forms' qid numbering is
  // entirely independent). Arrangement has no confirmed qid for
  // nextOfKinEmail, so none is sent — the dedicated NOK block below
  // (qids 277-279) is this form's only NOK prefill mechanism.
  if (config.externalFormId === ARRANGEMENT_FORMS_EXTERNAL_FORM_ID) {
    appendParam(params, '87', 'name87', 'first', decedent.first);
    appendParam(params, '87', 'name87', 'last', decedent.last);
    if (values.dateOfBirth) params.set('8_dateOf', values.dateOfBirth);
    if (values.dateOfDeath) params.set('10_dateOf10', values.dateOfDeath);
  }

  // Staff-audience-only: the visible case-number reference fields.
  if (config.audience === 'staff') {
    const caseNoFieldNames = CASE_NUMBER_QIDS[config.externalFormId] ?? [];
    const qids = ['1', '198'];
    caseNoFieldNames.forEach((name, i) => {
      if (values.caseNumber) params.set(`${qids[i]}_${name}`, values.caseNumber);
    });
  }

  // Arrangement Forms only (Phase A.2, 2026-09): the dedicated Next of
  // Kin fields added in Phase A (qids 277-279). SOLIS never knows
  // whether a future Informant will turn out to be the same person as
  // an already-known NOK, so qid 276 (the Yes/No branch question) is
  // NEVER prefilled here — the human must explicitly answer it every
  // time. If the human answers "No," these values save re-typing an
  // already-known NOK; if "Yes," extraction (arrangementNokDerivation.ts)
  // discards whatever is here regardless of these prefilled/stale values.
  if (config.externalFormId === ARRANGEMENT_FORMS_EXTERNAL_FORM_ID) {
    appendParam(params, '277', 'nextOf', 'first', nok.first);
    appendParam(params, '277', 'nextOf', 'last', nok.last);
    if (values.nextOfKinPhone) appendParam(params, '278', 'nextOf278', 'full', values.nextOfKinPhone);
    const relationshipDisplay = values.nextOfKinRelationship
      ? (ARRANGEMENT_NOK_RELATIONSHIP_REVERSE_MAP[values.nextOfKinRelationship] ?? null)
      : null;
    if (relationshipDisplay) params.set('279_nextOf279', relationshipDisplay);
  }

  // The one hidden field every prefill link must carry — the sole
  // authoritative linkage mechanism. Not yet present on the live forms
  // (see the integration's own remaining-Jotform-side-changes note); this
  // is where it will attach once added.
  params.set(config.linkTokenFieldName, rawLinkToken);

  return `https://form.jotform.com/${config.externalFormId}?${params.toString()}`;
}
