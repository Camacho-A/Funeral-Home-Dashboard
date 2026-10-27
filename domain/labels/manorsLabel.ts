import type { Case } from '@/types/case';
import { composeDecedentName } from '@/domain/cases/decedentName';
import { toDisplayCasingIfAllCaps } from '@/utils/string';
import { MANORS_LABEL_TEMPLATE_XML } from './manorsLabelTemplate.generated';

/**
 * Print Label (2026-10). Manors' approved DYMO label, filled for one case.
 *
 * The template (templates/manors-label.dymo) is the master and is never
 * changed: a copy is filled by replacing exactly three text values — the
 * sample name, tag and date the template was designed with — and nothing
 * else. Every object, font, size, position, fit setting and the logo stay
 * byte-for-byte as approved. The name box is the template's own "AlwaysFit"
 * box, so DYMO itself shrinks a long name to fit when it prints; SOLIS
 * never changes a font size or moves an object.
 */
export const MANORS_LABEL_SAMPLE_TEXT = {
  name: 'Richard Lewis Reynolds',
  tag: 'Tag #44471',
  date: 'October 24, 2026',
} as const;

export type ManorsLabelValues = { name: string; tag: string; date: string };

export type ManorsLabelField = 'name' | 'tag' | 'date';

export const MANORS_LABEL_FIELD_LABEL: Record<ManorsLabelField, string> = {
  name: 'Decedent name',
  tag: 'Tag #',
  date: 'Date of Cremation',
};

export type ManorsLabelResult =
  | { ok: true; values: ManorsLabelValues }
  | { ok: false; missing: ManorsLabelField[]; message: string };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "10/24/2026" → "October 24, 2026", the template's format. A string that
    is not a real MM/DD/YYYY date gives null, so it is refused as missing
    rather than printed wrong. */
export function formatLabelDate(caseDate: string | null | undefined): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((caseDate ?? '').trim());
  if (!match) return null;
  const [month, day, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** The three values for one case, or which of them are missing. */
export function manorsLabelValuesFor(
  case_: Pick<Case, 'decedentName' | 'decedentMiddleName' | 'tagNumber' | 'dateOfCremation'>,
): ManorsLabelResult {
  const name = toDisplayCasingIfAllCaps(composeDecedentName(case_.decedentName, case_.decedentMiddleName));
  const tagNumber = (case_.tagNumber ?? '').trim().replace(/^#\s*/, '');
  const date = formatLabelDate(case_.dateOfCremation);

  const missing: ManorsLabelField[] = [];
  if (name === '') missing.push('name');
  if (tagNumber === '') missing.push('tag');
  if (date === null) missing.push('date');
  if (missing.length > 0) {
    return { ok: false, missing, message: `Can't print the label yet. Add the ${joinFields(missing)} to this case first.` };
  }
  return { ok: true, values: { name, tag: `Tag #${tagNumber}`, date: date! } };
}

/** A filled copy of the template (without the file's byte-order mark,
    which the DYMO web service refuses). Throws if the template no longer
    holds each sample value exactly once — never fills a guessed spot. */
export function fillManorsLabel(values: ManorsLabelValues, template: string = MANORS_LABEL_TEMPLATE_XML): string {
  const source = template.replace(/^﻿/, '');
  // Every spot is located in the untouched template first, then filled from
  // the end backwards, so a filled value can never be mistaken for another
  // field's sample text.
  const spots = (['name', 'tag', 'date'] as const).map((field) => {
    const placeholder = `<Text>${MANORS_LABEL_SAMPLE_TEXT[field]}</Text>`;
    const at = source.indexOf(placeholder);
    if (at === -1 || source.indexOf(placeholder, at + 1) !== -1) {
      throw new Error(`The label template must contain "${MANORS_LABEL_SAMPLE_TEXT[field]}" exactly once.`);
    }
    return { at, length: placeholder.length, text: `<Text>${escapeXmlText(values[field])}</Text>` };
  });
  return spots
    .sort((a, b) => b.at - a.at)
    .reduce((xml, spot) => xml.slice(0, spot.at) + spot.text + xml.slice(spot.at + spot.length), source);
}

/** The file a saved label is stored as: the filled label with the same
    byte-order mark the approved template file starts with. */
export function manorsLabelFileBytes(labelXml: string): Buffer {
  return Buffer.from(`﻿${labelXml}`, 'utf8');
}

/** The label XML inside a stored .dymo file (byte-order mark removed —
    the DYMO web service refuses it). */
export function manorsLabelXmlFromFile(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}

/** The name, tag and date printed on a filled label — read back from the
    saved file itself, so staff see what the stored label says rather than
    what the case says now. Null if the file is not a filled copy of this
    template (seven text values, the last three ours). */
export function readManorsLabelValues(labelXml: string): ManorsLabelValues | null {
  const texts = Array.from(labelXml.matchAll(/<Text>([\s\S]*?)<\/Text>/g), (match) => unescapeXmlText(match[1]));
  if (texts.length !== 7) return null;
  return { name: texts[4], tag: texts[5], date: texts[6] };
}

function unescapeXmlText(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function joinFields(fields: ManorsLabelField[]): string {
  const labels = fields.map((field) => MANORS_LABEL_FIELD_LABEL[field]);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
