/**
 * Manors Jotform integration (case-first architecture, 2026-09). Builds a
 * Jotform prefill URL.
 *
 * PARAMETER CONVENTION — corrected 2026-10 after live verification.
 *
 * Jotform's URL prefill keys a value by the field's own `name` — `name87`
 * (simple) or `name87[first]` (compound) — NOT by `{qid}_{name}`, which
 * this module used previously and which silently does nothing.
 *
 * Verified directly against the live Arrangement form by loading prefill
 * URLs in a browser and reading the rendered inputs:
 *
 *   ?name87[first]=X&name87[last]=Y   -> both populate            ✅
 *   ?input274=X                       -> populates                ✅
 *   ?87_name87[first]=X               -> field stays EMPTY        ❌
 *   ?q87_name87[first]=X              -> field stays EMPTY        ❌
 *   ?solisLinkToken=X                 -> field stays EMPTY        ❌
 *
 * The inbound direction is unrelated and unchanged: a delivered
 * submission's `rawRequest` really does use `q{qid}_{name}` keys, and the
 * webhook reads answers from Jotform's authenticated API by qid anyway
 * (see domain/externalForms/parseWebhookPayload.ts). Prefill is outbound;
 * these are two different conventions and conflating them was the bug.
 *
 * WHY THIS MATTERED. The link token is the sole authoritative case-linkage
 * mechanism, and it was being sent under a key Jotform ignores — so every
 * SOLIS-generated form arrived with an EMPTY token field and every
 * submission came back unmatchable. This is the root cause of the
 * Arrangement webhook update path never having worked in production.
 *
 * `ssoPrefillKey` is deliberately NOT used. Both live token fields carry
 * `ssoPrefillKey: 'solisLinkToken'`, which is Jotform's SSO-prefill
 * feature, not URL prefill — verified above as having no effect on a plain
 * prefill URL.
 *
 * Never includes the raw link token anywhere but the one hidden field
 * parameter; never includes internal-only data on a family-audience form.
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

/**
 * `qid` is accepted (and deliberately unused for the key) so every caller
 * keeps naming the field it means by its stable qid — the identifier the
 * rest of this integration trusts — while the emitted key uses the only
 * form Jotform's URL prefill actually honours: the field's own name.
 */
function appendParam(params: URLSearchParams, qid: string, jotformName: string, subfield: string | undefined, value: string) {
  if (!value) return;
  void qid;
  const key = subfield ? `${jotformName}[${subfield}]` : jotformName;
  params.set(key, value);
}

/**
 * A Jotform `control_datetime` field is COMPOUND — it wants
 * `name[month]`, `name[day]`, `name[year]`, not one `MM/DD/YYYY` string.
 * Live-verified 2026-10: sending the whole string populated the month
 * dropdown only and silently left day and year blank.
 *
 * Accepts the `MM/DD/YYYY` format Case already stores. Anything that
 * isn't that shape is skipped entirely rather than partially applied —
 * a half-filled date on a death record is worse than an empty one.
 */
function appendDateParam(params: URLSearchParams, qid: string, jotformName: string, value: string | null) {
  if (!value) return;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return;
  const [, month, day, year] = match;
  void qid;
  params.set(`${jotformName}[month]`, month);
  params.set(`${jotformName}[day]`, day);
  params.set(`${jotformName}[year]`, year);
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
    appendDateParam(params, '10', 'dateof10', values.dateOfBirth);
    appendDateParam(params, '6', 'dateof', values.dateOfDeath);
    appendParam(params, '22', 'nextof', 'first', nok.first);
    appendParam(params, '22', 'nextof', 'last', nok.last);
    if (values.nextOfKinPhone) appendParam(params, '24', 'nextOf24', 'full', values.nextOfKinPhone);
    appendParam(params, '39', 'nextOf39', undefined, values.nextOfKinEmail ?? '');
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
    appendDateParam(params, '8', 'dateOf', values.dateOfBirth);
    appendDateParam(params, '10', 'dateOf10', values.dateOfDeath);
  }

  // Staff-audience-only: the visible case-number reference fields.
  if (config.audience === 'staff') {
    const caseNoFieldNames = CASE_NUMBER_QIDS[config.externalFormId] ?? [];
    const qids = ['1', '198'];
    caseNoFieldNames.forEach((name, i) => {
      appendParam(params, qids[i], name, undefined, values.caseNumber);
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
    appendParam(params, '279', 'nextOf279', undefined, relationshipDisplay ?? '');
  }

  // The one hidden field every prefill link must carry — the sole
  // authoritative linkage mechanism.
  //
  // `linkTokenFieldName` must hold the hidden field's own Jotform NAME,
  // which is per-form and genuinely unpredictable: it is `input274` on
  // Arrangement Forms but `solislinktoken` (lowercased) on Vital
  // Statistics. That is exactly the "a hidden field's internal name is not
  // derived from its display name" finding this integration already
  // records — which is why every INBOUND lookup is qid-driven. Prefill is
  // the one place Jotform forces us to use the name, so the config row
  // stores it verbatim rather than deriving it from anything.
  // A config with no token field name (e.g. a `case_create` form, which
  // has no link token at all) must not emit an empty-named parameter
  // carrying the raw token.
  if (config.linkTokenFieldName) {
    params.set(config.linkTokenFieldName, rawLinkToken);
  }

  return `https://form.jotform.com/${config.externalFormId}?${params.toString()}`;
}
