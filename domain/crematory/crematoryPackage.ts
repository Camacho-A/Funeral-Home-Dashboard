import { toDisplayCasingIfAllCaps } from '@/utils/string';

/**
 * Send to Crematory (2026-10). Pure rules for a Crematory Package — one PDF
 * per decedent (the approved state permit, then page 3 of that decedent's
 * Arrangement Form) — and for the one email that carries one or more of
 * them. Organization-neutral: the organization's display name comes in as a
 * parameter, so the same rules serve Manors today and Gus Camacho later.
 */

/** "11/06/2026" or "2026-11-06" → { month, day, year }; null if not a real date. */
export function parseCaseDate(value: string | null | undefined): { month: number; day: number; year: number } | null {
  const text = (value ?? '').trim();
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const [month, day, year] = us ? [Number(us[1]), Number(us[2]), Number(us[3])] : iso ? [Number(iso[2]), Number(iso[3]), Number(iso[1])] : [NaN, NaN, NaN];
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { month, day, year };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** MM/DD/YYYY, the form every case date is stored and shown in. */
export function toCaseDate(value: string | null | undefined): string | null {
  const parsed = parseCaseDate(value);
  return parsed ? `${pad(parsed.month)}/${pad(parsed.day)}/${parsed.year}` : null;
}

/** Characters no file system or mail client accepts in a file name. */
function sanitizeFileNamePart(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
}

/** The last name(s) and first name(s) a package file is named with. */
export type PackageName = { first: string; last: string };

/**
 * The confirmed package name, cleaned for a file name — or why it can't be
 * used. Names are taken exactly as entered (only characters no file system
 * accepts are removed); both parts are required. Never derived by
 * splitting a full name: "MARY ANN SMITH" cannot say which words are the
 * surname, so staff enter or confirm it.
 */
export function normalizePackageName(input: { first?: unknown; last?: unknown }): PackageName | { error: string } {
  const clean = (value: unknown) => (typeof value === 'string' ? sanitizeFileNamePart(value).slice(0, 80) : '');
  const first = clean(input.first);
  const last = clean(input.last);
  if (!last) return { error: 'Enter the last name (surname) for the package.' };
  if (!first) return { error: 'Enter the first name(s) for the package.' };
  return { first, last };
}

/**
 * A suggestion for staff to confirm, from the name exactly as the intake
 * form structured it (first / middle / last boxes). The middle name joins
 * the first ("Mary" + "Ann" → "Mary Ann"). Null when the form did not
 * provide both a first and a last name — never a guess.
 */
export function suggestPackageName(structured: { first?: string | null; middle?: string | null; last?: string | null }): PackageName | null {
  const tidy = (value: string | null | undefined) => toDisplayCasingIfAllCaps((value ?? '').trim().replace(/\s+/g, ' '));
  const first = [tidy(structured.first), tidy(structured.middle)].filter(Boolean).join(' ');
  const last = tidy(structured.last);
  if (!first || !last) return null;
  const normalized = normalizePackageName({ first, last });
  return 'error' in normalized ? null : normalized;
}

/** "First Last" for the email subject. */
export function packageDisplayName(name: PackageName): string {
  return `${name.first} ${name.last}`;
}

/**
 * LASTNAME_FIRSTNAME_CREMATORY_PACKAGE_MM-DD-YYYY.pdf (2026-10) — e.g.
 * WILLSON_HANNELORE_CREMATORY_PACKAGE_10-30-2026.pdf,
 * SALAS RUEDA_MARY ANN_CREMATORY_PACKAGE_11-06-2026.pdf. Multi-word names
 * keep their spaces — the underscores only ever separate surname, first
 * name(s) and the rest. The name is the one staff confirmed; the date is
 * the expected cremation ready date staff confirmed (never the send date,
 * never the Date of Cremation). Null when either is missing — a package is
 * never named with a guess.
 */
export function crematoryPackageFileName(name: PackageName | null | undefined, expectedReadyDate: string | null | undefined): string | null {
  const parts = fileNameParts(name, expectedReadyDate);
  return parts ? `${parts.last.toUpperCase()}_${parts.first.toUpperCase()}_CREMATORY_PACKAGE_${parts.date}.pdf` : null;
}

/**
 * The name packages were built with before 2026-10 (Willson_Hannelore_10-30-2026.pdf).
 * A package already built under it is still the current package for the
 * same name and date — never rebuilt just to be renamed; it is attached
 * under the new name.
 */
export function legacyCrematoryPackageFileName(name: PackageName | null | undefined, expectedReadyDate: string | null | undefined): string | null {
  const parts = fileNameParts(name, expectedReadyDate);
  return parts ? `${parts.last}_${parts.first}_${parts.date}.pdf` : null;
}

function fileNameParts(name: PackageName | null | undefined, expectedReadyDate: string | null | undefined): (PackageName & { date: string }) | null {
  if (!name) return null;
  const normalized = normalizePackageName(name);
  const date = parseCaseDate(expectedReadyDate);
  if ('error' in normalized || !date) return null;
  return { ...normalized, date: `${pad(date.month)}-${pad(date.day)}-${date.year}` };
}

/** The two source documents staff can pick from the case's untyped uploads (2026-10). */
export type CrematorySourceKind = 'state_permit' | 'arrangement_forms';

/** An active, untyped PDF already uploaded to the case — a candidate staff may choose. */
export type UntypedCaseDocument = { documentId: string; fileName: string; createdAt: string; suggestedAs: CrematorySourceKind | null };

/**
 * A suggestion only, from the file name ("BARBER PERMIT.pdf" → permit,
 * "…Arrangement…Forms.pdf" → Arrangement Form) — shown first for staff to
 * look at, never chosen for them.
 */
export function suggestSourceKind(fileName: string): CrematorySourceKind | null {
  if (/permit/i.test(fileName)) return 'state_permit';
  if (/arrang/i.test(fileName)) return 'arrangement_forms';
  return null;
}

/** The expected ready date encoded in a package file name, as MM/DD/YYYY. */
export function readyDateFromPackageFileName(fileName: string): string | null {
  const match = /_(\d{2})-(\d{2})-(\d{4})(?:_[^_]*)?\.pdf$/i.exec(fileName);
  return match ? toCaseDate(`${match[1]}/${match[2]}/${match[3]}`) : null;
}

/**
 * Attachment names for one email. Two decedents with the same name and
 * date would otherwise produce the same file name, so every colliding name
 * gets its case number added (Reynolds_Richard_11-06-2026_B2026-043.pdf);
 * names that don't collide are left as they are.
 */
export function assignAttachmentFileNames<T extends { fileName: string; caseNumber: string }>(items: readonly T[]): Array<T & { attachmentName: string }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.fileName.toLowerCase(), (counts.get(item.fileName.toLowerCase()) ?? 0) + 1);
  return items.map((item) => ({
    ...item,
    attachmentName:
      (counts.get(item.fileName.toLowerCase()) ?? 0) > 1
        ? item.fileName.replace(/\.pdf$/i, `_${sanitizeFileNamePart(item.caseNumber)}.pdf`)
        : item.fileName,
  }));
}

/**
 * The email subject.
 *   one case:                 Manors Cremation — Richard Reynolds — Expected 11/06/2026
 *   several, same date:       Manors Cremation — 4 Cases for Crematory — Expected 11/06/2026
 *   several, different dates: Manors Cremation — 4 Cases for Crematory
 */
export function crematoryEmailSubject(organizationName: string, cases: ReadonlyArray<{ decedentDisplayName: string; expectedReadyDate: string }>): string {
  if (cases.length === 1) return `${organizationName} — ${cases[0].decedentDisplayName} — Expected ${toCaseDate(cases[0].expectedReadyDate)}`;
  const dates = new Set(cases.map((c) => toCaseDate(c.expectedReadyDate)));
  const base = `${organizationName} — ${cases.length} Cases for Crematory`;
  return dates.size === 1 ? `${base} — Expected ${[...dates][0]}` : base;
}

/** A plain, editable starting message listing what is attached. */
export function defaultCrematoryMessage(organizationName: string, attachments: ReadonlyArray<{ decedentDisplayName: string; expectedReadyDate: string; attachmentName: string }>): string {
  const lines = attachments.map((a) => `- ${a.decedentDisplayName} — expected ${toCaseDate(a.expectedReadyDate)} (${a.attachmentName})`);
  return [
    'Hello,',
    '',
    `Please find attached the cremation permit and authorization for the following ${attachments.length === 1 ? 'case' : `${attachments.length} cases`}:`,
    '',
    ...lines,
    '',
    'Thank you,',
    organizationName,
  ].join('\n');
}
