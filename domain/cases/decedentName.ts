/**
 * The decedent's full name, with the middle name when there is one
 * (2026-10).
 *
 * ONE composition rule, used by every surface that shows a decedent —
 * header, case information, lists, search, calendar, notifications,
 * reports, exports, documents — so they can never disagree about whether
 * a middle name is shown or how the spacing works.
 *
 * `decedentName` is the full name as recorded and is never re-parsed: a
 * middle name is inserted after the FIRST token, which is where a middle
 * name goes, and the rest of the stored name is left exactly as it is.
 * That matters because surnames here are routinely multi-word
 * ("EVARISTA SILVA RIVERO") and any attempt to split them would get them
 * wrong.
 *
 * A blank, whitespace-only or absent middle name produces exactly the
 * stored name — never a double space, never a trailing space.
 */
export function composeDecedentName(
  decedentName: string,
  decedentMiddleName?: string | null,
): string {
  const full = (decedentName ?? '').trim();
  const middle = (decedentMiddleName ?? '').trim();
  if (middle === '') return full;
  if (full === '') return middle;

  // Already present (a name recorded in full before this field existed, or
  // a form that sent the whole name): don't say it twice.
  if (containsNamePart(full, middle)) return full;

  const firstSpace = full.indexOf(' ');
  if (firstSpace === -1) return `${full} ${middle}`;
  return `${full.slice(0, firstSpace)} ${middle}${full.slice(firstSpace)}`;
}

/** Whole-token, case-insensitive containment — so "ANN" does not count as
    already present in "ANNABELLE SMITH". */
function containsNamePart(full: string, part: string): boolean {
  const target = part.toLowerCase();
  return full
    .toLowerCase()
    .split(/\s+/)
    .some((token) => token === target);
}

/**
 * Whether a stored middle name should be replaced by an incoming one.
 *
 * Intake forms re-send every field on every submission, and a blank
 * middle-name box means "this form did not collect it", never "erase what
 * you have". A later Vital Statistics submission that leaves the middle
 * name empty must not wipe a value the Arrangement Form supplied.
 */
export function shouldApplyIncomingMiddleName(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): boolean {
  const next = (incoming ?? '').trim();
  if (next === '') return false;
  return next !== (existing ?? '').trim();
}
