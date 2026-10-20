import type { Case } from '../../types/case';

/**
 * Cremation dates (2026-10): date of cremation, date received, and the
 * expected pickup date are three separate facts.
 *
 * Case dates are stored MM/DD/YYYY; the pickup appointment and the native
 * date inputs use YYYY-MM-DD. These convert between the two, returning
 * null for anything that is not a real date rather than guessing.
 */
export function isoToCaseDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
  return `${month}/${day}/${year}`;
}

export function caseDateToIso(caseDate: string | null | undefined): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(caseDate?.trim() ?? '');
  return match ? `${match[3]}-${match[1]}-${match[2]}` : '';
}

/**
 * The day the cremains arrived, as YYYY-MM-DD, or null if not recorded.
 *
 * Before this change "Mark Received" stored the receipt date by moving the
 * pickup appointment's date onto it, and recorded nothing on the case. For
 * such a case (received, no `cremainsReceivedAt`) the appointment date IS
 * the receipt date, so it is used — but only then.
 */
export function receivedDateOf(
  case_: Pick<Case, 'cremainsReceivedAt'> | null,
  received: boolean,
  appointmentDate: string | null,
): string | null {
  const stored = caseDateToIso(case_?.cremainsReceivedAt);
  if (stored) return stored;
  return received ? appointmentDate : null;
}
