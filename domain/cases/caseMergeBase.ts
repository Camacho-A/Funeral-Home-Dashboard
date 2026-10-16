import type { Case, CaseUpdate } from '../../types/case';

/**
 * Phase 5A.1 (2026-10). Per-key compare-and-set for the three map fields a
 * case page edits one key at a time — a checklist tick, one checklist
 * field value, one VA step.
 *
 * Every case save carries the revision it was made against. For a
 * value-replacing edit any change since then is a conflict (409). A map
 * edit can be judged more precisely: alongside the revision the client
 * sends `baseValues` — the value each key it changes had when staff
 * clicked. If the case moved on but every one of those keys still holds
 * its base value, nobody else touched them: the edit is re-applied to the
 * case as it is now, so two people ticking DIFFERENT items both keep their
 * change. If any key moved (someone else ticked or unticked the SAME
 * item), the edit is refused — never silently overwritten.
 *
 * Without base values (or for a patch that also replaces any other field)
 * the strict rule applies.
 */

export const MERGE_SAFE_CASE_FIELDS = ['checklistState', 'fieldValues', 'vaStepsState'] as const;
export type MergeSafeCaseField = (typeof MERGE_SAFE_CASE_FIELDS)[number];

/** The value each changed map key had when the edit was made. */
export type CaseMapBaseValues = Partial<Record<MergeSafeCaseField, Record<string, unknown>>>;

type CaseMaps = Partial<Record<MergeSafeCaseField, unknown>>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True when the patch changes nothing but keys of the three maps. */
export function isMergeSafeCasePatch(patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((key) => (MERGE_SAFE_CASE_FIELDS as readonly string[]).includes(key) && isPlainObject(patch[key]));
}

/** Validates a request's `baseValues`: undefined when absent, 'invalid'
    when malformed. */
export function parseCaseMapBaseValues(value: unknown): CaseMapBaseValues | undefined | 'invalid' {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) return 'invalid';
  const parsed: CaseMapBaseValues = {};
  for (const [key, entries] of Object.entries(value)) {
    if (!(MERGE_SAFE_CASE_FIELDS as readonly string[]).includes(key) || !isPlainObject(entries)) return 'invalid';
    parsed[key as MergeSafeCaseField] = entries;
  }
  return parsed;
}

/** An absent key and null are the same "no value"; for the two boolean
    maps an unticked item may be absent or false — the same state. */
function normalized(field: MergeSafeCaseField, value: unknown): unknown {
  const v = value === undefined ? null : value;
  if ((field === 'checklistState' || field === 'vaStepsState') && v === null) return false;
  return v;
}

function sameMapValue(field: MergeSafeCaseField, a: unknown, b: unknown): boolean {
  return JSON.stringify(normalized(field, a)) === JSON.stringify(normalized(field, b));
}

/**
 * True when the patch is map-keys-only, a base value was given for EVERY
 * key it changes, and every one of those keys still holds its base value
 * in `current` — i.e. nobody else has changed what this edit changes.
 */
export function mapKeysStillAtBase(current: CaseMaps, patch: Record<string, unknown>, base: CaseMapBaseValues | undefined): boolean {
  if (!base || !isMergeSafeCasePatch(patch)) return false;
  for (const field of MERGE_SAFE_CASE_FIELDS) {
    const changes = patch[field];
    if (changes === undefined) continue;
    const fieldBase = base[field];
    if (!fieldBase) return false;
    const currentMap = isPlainObject(current[field]) ? (current[field] as Record<string, unknown>) : {};
    for (const key of Object.keys(changes as Record<string, unknown>)) {
      if (!Object.prototype.hasOwnProperty.call(fieldBase, key)) return false;
      if (!sameMapValue(field, currentMap[key], fieldBase[key])) return false;
    }
  }
  return true;
}

/**
 * Client side: the base values for a map edit, read from the case the page
 * holds at click time (before any optimistic update). Undefined when the
 * patch is not map-keys-only.
 */
export function captureCaseMapBaseValues(current: Case | undefined | null, patch: CaseUpdate): CaseMapBaseValues | undefined {
  if (!current || !isMergeSafeCasePatch(patch as Record<string, unknown>)) return undefined;
  const base: CaseMapBaseValues = {};
  for (const field of MERGE_SAFE_CASE_FIELDS) {
    const changes = (patch as Record<string, unknown>)[field] as Record<string, unknown> | undefined;
    if (!changes) continue;
    const source = ((current as unknown as Record<string, unknown>)[field] ?? {}) as Record<string, unknown>;
    base[field] = Object.fromEntries(Object.keys(changes).map((key) => [key, source[key] ?? null]));
  }
  return base;
}
