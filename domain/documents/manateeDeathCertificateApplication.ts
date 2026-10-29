import type { NextOfKinRelationship } from '@/types/case';
import type { CaseDocument } from '@/types/caseDocument';

/**
 * Manatee County — Death Certificate Application (2026-10). The rules for
 * filling Manors' own copy of form DH 1961, "Application for a Florida
 * Death Record" (Florida Department of Health in Manatee County), from a
 * case. Pure: no I/O, no case writes.
 *
 * The form is filled through its own fillable fields, plus — only when
 * staff confirm the FedEx fee — the two blank spaces on its FedEx row
 * (quantity and line total; the $15.00 is already printed). Everything
 * printed on it — the county's details, Manors' prefilled applicant
 * (name, Funeral Director, license, address, signature), the $8.00 and
 * $15.00 prices — is left exactly as it is. The saved copy is flattened so
 * it cannot be edited; a correction is a new version made through SOLIS.
 *
 * Nothing is guessed. A name is only ever taken from structured first /
 * middle / last boxes (an intake form's, or staff's), never split from a
 * full name; a county only from a record of it (staff otherwise — never
 * from a city name); a relationship the form cannot state unambiguously
 * ("Parent" — Mother or Father?) is left for staff. Anything required and
 * missing blocks the document until staff enter it in the generation
 * window — which never writes it back to the case.
 */

/** The template's own field names (verified against the supplied PDF). */
export const MANATEE_FIELDS = {
  decedentFirst: 'First Name',
  decedentMiddle: 'Middle',
  decedentLast: 'Last',
  /** The SEX box (a blank / F / M list) — named "Suffix2" in the template. */
  decedentSex: 'Suffix2',
  ssn: 'SS',
  deathMonth: 'Month',
  deathDay: 'Day',
  deathYear: 'Year',
  placeOfDeathCity: 'Place of Death',
  placeOfDeathCounty: 'County',
  spouseFirst: 'First Name2',
  spouseMiddle: 'Middle2',
  spouseLast: 'Last2',
  representedName: 'Represented',
  representedRelationship: 'Relationship',
  withCauseQuantity: 'Text1',
  withoutCauseQuantity: 'Text2',
  withCauseTotal: 'Text3',
  withoutCauseTotal: 'Text4',
  grandTotal: 'Text8',
  /** "Request ___ of ___" — only ever what staff typed. */
  requestNumber: '1 OF',
  requestOf: 'of',
} as const;

/** Fields this document may fill (the Request boxes only when staff typed
    them). Every other field on the form — the prefilled applicant, prices,
    "ON FILE", "N/A", funeral home — is never touched. */
export const MANATEE_FILLED_FIELD_NAMES: readonly string[] = Object.values(MANATEE_FIELDS);

/** As printed on the form. Changing either needs explicit approval. */
export const PRICE_PER_CERTIFICATE_CENTS = 800;
export const FEDEX_FEE_CENTS = 1500;
/** The form's own printed prices, checked against the template before filling. */
export const PRINTED_PRICE_TEXT = '$8.00';

/** The largest quantity accepted — far above any real order, so a typo
    (800 for 8) is caught rather than printed. */
export const MAX_CERTIFICATES_PER_LINE = 99;

const tidy = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const upper = (value: string | null | undefined) => tidy(value).toUpperCase();

/**
 * The FedEx row's two blank spaces, measured from the form: the quantity
 * and line-total underlines sit 23 pt below the certificate rows' and span
 * the same width, so the values are set exactly as the rows above them
 * are (same box size, Helvetica 9, centred). The $15.00 between them is
 * printed on the form and never redrawn.
 */
export const FEDEX_ENTRY_BOXES = {
  quantity: { x: 313, y: 78.5, width: 36, height: 14 },
  total: { x: 500, y: 78.5, width: 83, height: 14 },
} as const;

/** The FedEx row's entries, or null — the row stays blank — without the fee. */
export function fedexEntries(fedexFee: boolean): { quantity: string; total: string } | null {
  return fedexFee ? { quantity: '1', total: formatMoney(FEDEX_FEE_CENTS) } : null;
}

/**
 * The relationship as the form's Relationship list words it. Null when
 * the case's relationship cannot be stated without a guess (a parent,
 * grandchild or grandparent, whose list entries are gendered) or is not
 * recorded — staff then choose.
 */
export function relationshipForForm(relationship: NextOfKinRelationship | null | undefined, other: string | null | undefined): string | null {
  switch (relationship) {
    case 'spouse':
      return 'Spouse';
    case 'son':
      return 'Son';
    case 'daughter':
      return 'Daughter';
    case 'brother':
      return 'Brother';
    case 'sister':
      return 'Sister';
    case 'niece':
      return 'Niece';
    case 'nephew':
      return 'Nephew';
    case 'domestic_partner':
      return 'Domestic Partner';
    case 'legal_representative':
      return 'Legal Representative';
    case 'friend':
      return 'Friend';
    case 'other':
    case 'other_relative':
      return tidy(other) || null;
    default:
      return null;
  }
}

/** The form's Relationship list, offered to staff alongside free text. */
export const FORM_RELATIONSHIP_OPTIONS = [
  'Aunt', 'Brother', 'Brother-in-law', 'Cousin', 'Daughter', 'Father', 'Granddaughter', 'Grandfather', 'Grandmother',
  'Grandson', 'Legal Guardian', 'Mother', 'Nephew', 'Niece', 'Sister', 'Son', 'Spouse', 'Uncle',
] as const;

/** 9 digits → ###-##-####; anything else → null. */
export function normalizeSsn(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 9 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : null;
}

/** "•••-••-6789" — the only form an SSN is ever shown or reported in. */
export function maskSsn(ssn: string | null | undefined): string | null {
  const normalized = normalizeSsn(ssn);
  return normalized ? `•••-••-${normalized.slice(-4)}` : null;
}

/** MM/DD/YYYY (or YYYY-MM-DD) → the form's Month / Day / Year boxes. */
export function dateOfDeathParts(value: string | null | undefined): { month: string; day: string; year: string } | null {
  const text = tidy(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const [month, day, year] = us ? [Number(us[1]), Number(us[2]), Number(us[3])] : iso ? [Number(iso[2]), Number(iso[3]), Number(iso[1])] : [NaN, NaN, NaN];
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  // The form's own lists use unpadded numbers ("1".."12", "1".."31").
  return { month: String(month), day: String(day), year: String(year) };
}

export type ManateeFees = {
  withCauseTotalCents: number;
  withoutCauseTotalCents: number;
  fedexCents: number;
  grandTotalCents: number;
};

export function manateeFees(withCause: number, withoutCause: number, fedexFee: boolean): ManateeFees {
  const withCauseTotalCents = withCause * PRICE_PER_CERTIFICATE_CENTS;
  const withoutCauseTotalCents = withoutCause * PRICE_PER_CERTIFICATE_CENTS;
  const fedexCents = fedexFee ? FEDEX_FEE_CENTS : 0;
  return { withCauseTotalCents, withoutCauseTotalCents, fedexCents, grandTotalCents: withCauseTotalCents + withoutCauseTotalCents + fedexCents };
}

/** "16.00" — the form's own total format (no $; the "0.00" it ships with). */
export function formatMoney(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** The form's SEX box: F or M, blank until known. */
export type ManateeSex = '' | 'F' | 'M';

/** An intake form's Male / Female answer as the form's box; anything else is left for staff. */
export function sexForForm(answer: unknown): ManateeSex {
  const value = typeof answer === 'string' ? answer.trim().toLowerCase() : '';
  return value === 'female' ? 'F' : value === 'male' ? 'M' : '';
}

/** Everything the document prints, as staff confirmed it. */
export type ManateeApplicationValues = {
  decedentFirst: string;
  decedentMiddle: string;
  decedentLast: string;
  decedentSex: ManateeSex;
  /** The full SSN — only ever on the server and in the filled PDF. */
  ssn: string | null;
  /** Staff confirmed the SSN is not known; the box is left blank. */
  ssnNotKnown: boolean;
  dateOfDeath: string;
  placeOfDeathCity: string;
  placeOfDeathCounty: string;
  spouseFirst: string;
  spouseMiddle: string;
  spouseLast: string;
  representedName: string;
  representedRelationship: string;
  withCause: number;
  withoutCause: number;
  fedexFee: boolean;
  /** "Request ___ of ___" — blank unless staff type both. */
  requestNumber: string;
  requestOf: string;
};

export type ManateeIssue = { field: keyof ManateeApplicationValues; message: string };

const isQuantity = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_CERTIFICATES_PER_LINE;

/** What still needs staff before the document can be made. Never names an SSN. */
export function manateeIssues(values: ManateeApplicationValues): ManateeIssue[] {
  const issues: ManateeIssue[] = [];
  if (!tidy(values.decedentFirst)) issues.push({ field: 'decedentFirst', message: "Enter the decedent's first name." });
  if (!tidy(values.decedentLast)) issues.push({ field: 'decedentLast', message: "Enter the decedent's last name." });
  if (values.decedentSex !== 'F' && values.decedentSex !== 'M') issues.push({ field: 'decedentSex', message: "Select the decedent's sex (F or M)." });
  if (!values.ssnNotKnown && !normalizeSsn(values.ssn)) {
    issues.push({ field: 'ssn', message: 'Enter the 9-digit Social Security number, or mark it as not known.' });
  }
  if (!dateOfDeathParts(values.dateOfDeath)) issues.push({ field: 'dateOfDeath', message: 'Enter the date of death (MM/DD/YYYY).' });
  if (!tidy(values.placeOfDeathCity)) issues.push({ field: 'placeOfDeathCity', message: 'Enter the city or town of death.' });
  if (!tidy(values.placeOfDeathCounty)) issues.push({ field: 'placeOfDeathCounty', message: 'Enter the county of death.' });
  const spouseGiven = [values.spouseFirst, values.spouseMiddle, values.spouseLast].some((part) => tidy(part));
  if (spouseGiven && (!tidy(values.spouseFirst) || !tidy(values.spouseLast))) {
    issues.push({ field: 'spouseLast', message: "Enter the surviving spouse's first and last name, or clear the spouse." });
  }
  if (!tidy(values.representedName)) issues.push({ field: 'representedName', message: 'Enter the next of kin (person represented).' });
  if (!tidy(values.representedRelationship)) issues.push({ field: 'representedRelationship', message: "Enter the next of kin's relationship to the decedent." });
  if (!isQuantity(values.withCause)) issues.push({ field: 'withCause', message: `With cause: a whole number from 0 to ${MAX_CERTIFICATES_PER_LINE}.` });
  if (!isQuantity(values.withoutCause)) issues.push({ field: 'withoutCause', message: `Without cause: a whole number from 0 to ${MAX_CERTIFICATES_PER_LINE}.` });
  if (isQuantity(values.withCause) && isQuantity(values.withoutCause) && values.withCause + values.withoutCause === 0) {
    issues.push({ field: 'withCause', message: 'Order at least one death certificate.' });
  }
  const request = tidy(values.requestNumber);
  const of = tidy(values.requestOf);
  if (request || of) {
    const [n, total] = [Number(request), Number(of)];
    const valid = /^\d{1,2}$/.test(request) && /^\d{1,2}$/.test(of) && n >= 1 && n <= total;
    if (!valid) issues.push({ field: 'requestNumber', message: 'Request ___ of ___: enter both numbers (e.g. 1 of 2), or leave both blank.' });
  }
  return issues;
}

/** The exact text each filled field receives (uppercase, as the form's own
    prefilled entries are). Only called once there are no issues. */
export function manateeFieldValues(values: ManateeApplicationValues): Record<string, string> {
  const date = dateOfDeathParts(values.dateOfDeath)!;
  const fees = manateeFees(values.withCause, values.withoutCause, values.fedexFee);
  return {
    [MANATEE_FIELDS.decedentFirst]: upper(values.decedentFirst),
    [MANATEE_FIELDS.decedentMiddle]: upper(values.decedentMiddle),
    [MANATEE_FIELDS.decedentLast]: upper(values.decedentLast),
    [MANATEE_FIELDS.decedentSex]: values.decedentSex,
    [MANATEE_FIELDS.ssn]: values.ssnNotKnown ? '' : (normalizeSsn(values.ssn) ?? ''),
    [MANATEE_FIELDS.deathMonth]: date.month,
    [MANATEE_FIELDS.deathDay]: date.day,
    [MANATEE_FIELDS.deathYear]: date.year,
    [MANATEE_FIELDS.placeOfDeathCity]: upper(values.placeOfDeathCity),
    [MANATEE_FIELDS.placeOfDeathCounty]: upper(values.placeOfDeathCounty),
    [MANATEE_FIELDS.spouseFirst]: upper(values.spouseFirst),
    [MANATEE_FIELDS.spouseMiddle]: upper(values.spouseMiddle),
    [MANATEE_FIELDS.spouseLast]: upper(values.spouseLast),
    [MANATEE_FIELDS.representedName]: upper(values.representedName),
    [MANATEE_FIELDS.representedRelationship]: tidy(values.representedRelationship),
    [MANATEE_FIELDS.withCauseQuantity]: String(values.withCause),
    [MANATEE_FIELDS.withoutCauseQuantity]: String(values.withoutCause),
    [MANATEE_FIELDS.withCauseTotal]: formatMoney(fees.withCauseTotalCents),
    [MANATEE_FIELDS.withoutCauseTotal]: formatMoney(fees.withoutCauseTotalCents),
    [MANATEE_FIELDS.grandTotal]: formatMoney(fees.grandTotalCents),
    // Only when staff typed them; otherwise the boxes are left untouched.
    ...(tidy(values.requestNumber) && tidy(values.requestOf)
      ? { [MANATEE_FIELDS.requestNumber]: tidy(values.requestNumber), [MANATEE_FIELDS.requestOf]: tidy(values.requestOf) }
      : {}),
  };
}

export const MANATEE_APPLICATION_FILE_NAME = 'Manatee County Death Certificate Application.pdf';

/** Where a suggested value came from, shown to staff beside it. */
export type ManateeFormSource = 'arrangement_form' | 'vital_statistics' | 'first_call_sheet';
export type ManateeValueSource = ManateeFormSource | 'case' | null;

/** Everything but the SSN, which stays on the server. */
export type ManateeDraftValues = Omit<ManateeApplicationValues, 'ssn'>;

/** What the generation window opens with. */
export type ManateeDraft = {
  values: ManateeDraftValues;
  /** Never the number itself — whether one is on file and its last four. */
  ssn: { onFile: boolean; masked: string | null; source: ManateeValueSource; /** The case's locked SSN (2026-10) — used as is, not replaceable here. */ locked: boolean };
  sources: Partial<Record<keyof ManateeDraftValues, ManateeValueSource>>;
  issues: ManateeIssue[];
  template: 'available' | 'not_configured' | 'not_found';
  pricing: { perCertificateCents: number; fedexCents: number; maxPerLine: number };
  latest: Pick<CaseDocument, 'id' | 'version' | 'createdAt'> | null;
};

/** What the browser sends: the reviewed values, and an SSN only if staff typed one. */
export type ManateeApplicationInput = ManateeDraftValues & { ssn?: string | null };
