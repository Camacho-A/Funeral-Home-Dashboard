/**
 * Manors Jotform integration (case-first architecture, 2026-09). Turns a
 * raw Jotform submission's answers (keyed by qid, matching the shape
 * confirmed from the real `/submission/{id}` API response — never
 * assumed from webhook documentation alone) into Solis-field-shaped
 * values, using one form's FieldMapEntry[] (domain/externalForms/fieldMapping.ts).
 * Pure function — never touches a Case, never persists anything; this is
 * the "mappedFields" computation `ExternalFormSubmission.mappedFields`
 * caches at receipt time.
 */
import type { FieldMapEntry, MappedSolisField } from './fieldMapping';

/** A qid-indexed answer, matching /submission/{id}'s own `answers` shape:
    a plain string answer, or a sub-keyed object for a compound field
    (fullname/phone/address). */
export type JotformAnswerMap = Record<string, { answer?: string | Record<string, string> }>;

/** Exported for reuse by arrangementNokDerivation.ts — that module reads
    qids 276-279 directly from the raw answer map (they're deliberately
    absent from any FieldMapEntry, see fieldMapping.ts's own comment), and
    must use this exact same qid/subfield reading logic rather than a
    second, parallel implementation. */
export function readAnswerValue(answers: JotformAnswerMap, qid: string, subfield?: string): string | null {
  const entry = answers[qid];
  if (!entry || entry.answer === undefined) return null;
  if (subfield) {
    if (typeof entry.answer !== 'object' || entry.answer === null) return null;
    const value = entry.answer[subfield];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
  return typeof entry.answer === 'string' && entry.answer.trim() ? entry.answer.trim() : null;
}

/** Joins the first/last halves of a compound-name mapping back into one
    Solis-shaped string — mirrors how Case.decedentName/nextOfKinName are
    already stored as a single field. */
function combineNameParts(entries: FieldMapEntry[], field: MappedSolisField, answers: JotformAnswerMap): string | null {
  const parts = entries.filter((e) => e.solisField === field);
  const first = parts.find((e) => e.subfield === 'first');
  const last = parts.find((e) => e.subfield === 'last');
  const firstValue = first ? readAnswerValue(answers, first.qid, 'first') : null;
  const lastValue = last ? readAnswerValue(answers, last.qid, 'last') : null;
  if (!firstValue && !lastValue) return null;
  return [firstValue, lastValue].filter(Boolean).join(' ');
}

const COMPOUND_NAME_FIELDS: MappedSolisField[] = ['decedentName', 'nextOfKinName', 'pickupReleasedTo', 'informantName'];

/** Historical-import investigation (2026-09): a live Arrangement Forms
    submission confirmed qids 8/10 (DOB/DOD) are `control_datetime`
    fields whose real answer shape is a compound object
    (`{month, day, year, datetime}`), not the plain string every
    FieldMapEntry for these fields previously assumed. Vital Statistics'
    own qid 6/10 have never been confirmed against a real submission —
    this combiner handles BOTH shapes safely so it's correct either way. */
const COMPOUND_DATE_FIELDS: MappedSolisField[] = ['dateOfBirth', 'dateOfDeath'];

/** Same investigation: Arrangement's qid 97 (Place of Death) is a
    `control_address` field — also a compound object, not a plain
    string. */
const COMPOUND_ADDRESS_FIELDS: MappedSolisField[] = ['placeOfDeath'];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Reads a compound Jotform datetime answer's month/day/year subfields
    and constructs a Solis-shaped MM/DD/YYYY string. Never guesses a
    missing component; never accepts an impossible calendar date (e.g.
    day=32 or Feb 30) — validated via a real Date round-trip, since
    JavaScript's Date constructor would otherwise silently roll an
    invalid day/month into the next period rather than rejecting it.
    Falls through to the existing plain-string behavior unchanged when
    the raw answer genuinely already is a string, so this stays correct
    even if a form's true shape differs from what's been confirmed here. */
function combineDateParts(qid: string, answers: JotformAnswerMap): string | null {
  const entry = answers[qid];
  if (!entry || entry.answer === undefined) return null;

  if (typeof entry.answer === 'string') {
    return entry.answer.trim() ? entry.answer.trim() : null;
  }
  if (typeof entry.answer !== 'object' || entry.answer === null) return null;

  const monthRaw = entry.answer.month;
  const dayRaw = entry.answer.day;
  const yearRaw = entry.answer.year;
  if (!monthRaw || !dayRaw || !yearRaw) return null;

  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000 || year > 9999) return null;

  const constructed = new Date(year, month - 1, day);
  if (constructed.getFullYear() !== year || constructed.getMonth() !== month - 1 || constructed.getDate() !== day) {
    return null;
  }

  return `${pad2(month)}/${pad2(day)}/${year}`;
}

/** Reads a compound Jotform address answer and normalizes it to Solis's
    existing short, facility/location-style Place of Death convention
    (e.g. "ST. MARY'S HOSPITAL") — never a full multi-line mailing
    address. Prefers `addr_line1`: Jotform's own sublabel for this
    specific subfield is literally "Hospital or Location Name & Address",
    so staff are already entering a facility/location descriptor there,
    not a bare street address. Falls back to "city, state" only when
    `addr_line1` is blank. */
function combineAddressParts(qid: string, answers: JotformAnswerMap): string | null {
  const entry = answers[qid];
  if (!entry || entry.answer === undefined) return null;

  if (typeof entry.answer === 'string') {
    return entry.answer.trim() ? entry.answer.trim() : null;
  }
  if (typeof entry.answer !== 'object' || entry.answer === null) return null;

  const addrLine1 = typeof entry.answer.addr_line1 === 'string' ? entry.answer.addr_line1.trim() : '';
  if (addrLine1) return addrLine1;

  const city = typeof entry.answer.city === 'string' ? entry.answer.city.trim() : '';
  const state = typeof entry.answer.state === 'string' ? entry.answer.state.trim() : '';
  if (city && state) return `${city}, ${state}`;
  return city || state || null;
}

export function extractMappedFields(fieldMap: FieldMapEntry[], answers: JotformAnswerMap): Partial<Record<MappedSolisField, string>> {
  const result: Partial<Record<MappedSolisField, string>> = {};
  const handledCompound = new Set<MappedSolisField>();

  for (const entry of fieldMap) {
    if (COMPOUND_NAME_FIELDS.includes(entry.solisField)) {
      if (handledCompound.has(entry.solisField)) continue;
      const combined = combineNameParts(fieldMap, entry.solisField, answers);
      if (combined) result[entry.solisField] = combined;
      handledCompound.add(entry.solisField);
      continue;
    }

    if (COMPOUND_DATE_FIELDS.includes(entry.solisField)) {
      if (handledCompound.has(entry.solisField)) continue;
      const combined = combineDateParts(entry.qid, answers);
      if (combined) result[entry.solisField] = combined;
      handledCompound.add(entry.solisField);
      continue;
    }

    if (COMPOUND_ADDRESS_FIELDS.includes(entry.solisField)) {
      if (handledCompound.has(entry.solisField)) continue;
      const combined = combineAddressParts(entry.qid, answers);
      if (combined) result[entry.solisField] = combined;
      handledCompound.add(entry.solisField);
      continue;
    }

    const raw = readAnswerValue(answers, entry.qid, entry.subfield);
    if (raw === null) continue;
    const value = entry.valueMap ? (entry.valueMap[raw] ?? null) : raw;
    if (value !== null) result[entry.solisField] = value;
  }

  return result;
}
