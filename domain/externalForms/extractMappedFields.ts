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

function readAnswerValue(answers: JotformAnswerMap, qid: string, subfield?: string): string | null {
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

const COMPOUND_NAME_FIELDS: MappedSolisField[] = ['decedentName', 'nextOfKinName', 'pickupReleasedTo'];

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

    const raw = readAnswerValue(answers, entry.qid, entry.subfield);
    if (raw === null) continue;
    const value = entry.valueMap ? (entry.valueMap[raw] ?? null) : raw;
    if (value !== null) result[entry.solisField] = value;
  }

  return result;
}
