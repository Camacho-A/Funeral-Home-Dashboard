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

export type PrefillableCaseValues = {
  caseNumber: string;
  decedentName: string | null;
  dateOfBirth: string | null; // MM/DD/YYYY, matches Case's own stored format
  dateOfDeath: string | null;
  nextOfKinName: string | null;
  nextOfKinPhone: string | null;
  nextOfKinEmail: string | null;
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

  // Fields common to both audiences — never internal-only data.
  appendParam(params, '3', 'nameof', 'first', decedent.first);
  appendParam(params, '3', 'nameof', 'last', decedent.last);
  if (values.dateOfBirth) params.set('10_dateof10', values.dateOfBirth);
  if (values.dateOfDeath) params.set('6_dateof', values.dateOfDeath);
  appendParam(params, '22', 'nextof', 'first', nok.first);
  appendParam(params, '22', 'nextof', 'last', nok.last);
  if (values.nextOfKinPhone) appendParam(params, '24', 'nextOf24', 'full', values.nextOfKinPhone);
  if (values.nextOfKinEmail) params.set('39_nextOf39', values.nextOfKinEmail);

  // Staff-audience-only: the visible case-number reference fields.
  if (config.audience === 'staff') {
    const caseNoFieldNames = CASE_NUMBER_QIDS[config.externalFormId] ?? [];
    const qids = ['1', '198'];
    caseNoFieldNames.forEach((name, i) => {
      if (values.caseNumber) params.set(`${qids[i]}_${name}`, values.caseNumber);
    });
  }

  // The one hidden field every prefill link must carry — the sole
  // authoritative linkage mechanism. Not yet present on the live forms
  // (see the integration's own remaining-Jotform-side-changes note); this
  // is where it will attach once added.
  params.set(config.linkTokenFieldName, rawLinkToken);

  return `https://form.jotform.com/${config.externalFormId}?${params.toString()}`;
}
