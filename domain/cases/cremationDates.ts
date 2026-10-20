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
 * Date received: the day Manors actually received the cremated remains.
 *
 * It is only ever the date stored on the case (`cremainsReceivedAt`).
 * Nothing is substituted when it is missing: not the expected pickup date,
 * not the date of cremation, not the release date. A case marked received
 * before the date was recorded (the old checklist and "Mark Received"
 * workflows wrote nothing on the case) reads "Received (date not
 * recorded)" until staff enter the real date.
 *
 * `received` is whether the cremains are known to have arrived (the
 * expected pickup is complete). A stored date always counts as received.
 */
export type DateReceived =
  | { kind: 'recorded'; date: string }
  | { kind: 'date_not_recorded' }
  | { kind: 'not_received' };

export const DATE_RECEIVED_NOT_RECORDED_LABEL = 'Received (date not recorded)';
export const NOT_YET_RECEIVED_LABEL = 'Not yet received';

export function dateReceivedOf(case_: Pick<Case, 'cremainsReceivedAt'> | null, received: boolean): DateReceived {
  const stored = caseDateToIso(case_?.cremainsReceivedAt);
  if (stored) return { kind: 'recorded', date: stored };
  return received ? { kind: 'date_not_recorded' } : { kind: 'not_received' };
}

/** The text every view shows for Date received; `formatDate` renders a
    recorded YYYY-MM-DD date in that view's own style. */
export function dateReceivedLabel(value: DateReceived, formatDate: (isoDate: string) => string): string {
  if (value.kind === 'recorded') return formatDate(value.date);
  return value.kind === 'date_not_recorded' ? DATE_RECEIVED_NOT_RECORDED_LABEL : NOT_YET_RECEIVED_LABEL;
}
