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

/**
 * The decedent's last and first name for the file name. `decedentName` is
 * the full name as recorded ("FIRST LAST"); the first word is the first
 * name and EVERYTHING after it is the surname, so multi-word surnames
 * ("Salas Rueda", "de la Cruz") are kept whole. The middle name lives in
 * its own field and is not part of the file name. All-caps names are shown
 * in normal capitalisation; anything else is kept as written.
 */
export function packageNameParts(decedentName: string): { first: string; last: string } | null {
  const words = (decedentName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const first = sanitizeFileNamePart(toDisplayCasingIfAllCaps(words[0]));
  const last = sanitizeFileNamePart(toDisplayCasingIfAllCaps(words.slice(1).join(' ')));
  if (!first) return null;
  return { first, last };
}

/**
 * LastName_FirstName_MM-DD-YYYY.pdf — e.g. Reynolds_Richard_11-06-2026.pdf.
 * The date is the expected cremation ready date the staff member confirmed
 * (never the send date, never the Date of Cremation). Null when the name or
 * date is missing — a package is never named with a guess.
 */
export function crematoryPackageFileName(decedentName: string, expectedReadyDate: string | null | undefined): string | null {
  const name = packageNameParts(decedentName);
  const date = parseCaseDate(expectedReadyDate);
  if (!name || !date) return null;
  const who = name.last ? `${name.last}_${name.first}` : name.first;
  return `${who}_${pad(date.month)}-${pad(date.day)}-${date.year}.pdf`;
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
