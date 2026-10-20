import fs from 'fs/promises';
import path from 'path';
import { PDFButton, PDFDocument, PDFTextField, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/**
 * Manors' own Envelope and Certificate of Cremation, filled from the
 * OFFICIAL files (2026-10). Nothing here redraws either document: the
 * official page is the background, and only the case's own values are
 * added to it.
 *
 * ENVELOPE — assets/documents/manors-envelope.pdf is "Manors Envelope
 * English Broward Office.docx" exported to PDF by Microsoft Word, with only
 * the sample decedent's name removed (a pixel diff against Word's export of
 * the untouched file differs in that name's box and nowhere else). The name
 * is then drawn where Word drew the sample: centered on the page, on the
 * same baseline, at the same width (see ENVELOPE_NAME_LAYOUT). The
 * template's font, Baskerville, is an Apple system font that cannot be
 * shipped in this (public) repository, so the name uses Libre Baskerville (SIL Open Font License, licence file beside
 * it) — the closest freely licensed Baskerville revival. Everything else on
 * the envelope is Word's own rendering of the original.
 *
 * CERTIFICATE OF CREMATION — the signed, fillable PDF itself. Its own form
 * fields are filled in their own declared fonts (Times-Bold 14 for the tag
 * number and name, Times-Roman 13 for the dates — standard PDF fonts, so
 * exact), the on-screen "Reset Form" / "Print" buttons are removed (they
 * are not printable in the original either), and the form is flattened so
 * the certificate cannot be edited afterwards. The template carries a real
 * signature and seal, so it is NOT stored in this repository: it is read
 * from private document storage (see loadCertificateTemplate).
 */

const ASSETS = path.join(process.cwd(), 'assets', 'documents');

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/** Where Word placed the sample name, measured from its own export. */
export const ENVELOPE_NAME_LAYOUT = {
  baselineFromTopPt: 179.85,
  /**
   * The template sets the name at 14pt Baskerville. Libre Baskerville is
   * drawn larger at the same nominal size (the template's own sample name
   * measures 240pt wide in it against 189pt in Word's rendering), so the
   * size is calibrated to Word's: the sample name comes out the same width
   * and on the same baseline as on the official envelope.
   */
  fontSizePt: 11.03,
  minFontSizePt: 8,
  /** The page's left/right margins (0.3in each) — the name never runs into them. */
  sideMarginPt: 21.6,
} as const;

/** The template's size, reduced in half-points only as far as needed for a
    long name to fit between the page margins. */
export function envelopeNameFontSize(widthAtSize: (size: number) => number, pageWidth: number): number {
  const available = pageWidth - 2 * ENVELOPE_NAME_LAYOUT.sideMarginPt;
  let size: number = ENVELOPE_NAME_LAYOUT.fontSizePt;
  while (size > ENVELOPE_NAME_LAYOUT.minFontSizePt && widthAtSize(size) > available) size -= 0.5;
  return Math.max(size, ENVELOPE_NAME_LAYOUT.minFontSizePt);
}

export function envelopeNameLine(decedentDisplayName: string): string {
  return `${decedentDisplayName.trim()} (Deceased)`;
}

export async function buildEnvelopePdf(params: { decedentDisplayName: string }): Promise<Uint8Array> {
  const name = params.decedentDisplayName.trim();
  if (!name) throw new OfficialTemplateError('The envelope needs the decedent\'s name.');

  const [templateBytes, fontBytes] = await Promise.all([
    fs.readFile(path.join(ASSETS, 'manors-envelope.pdf')),
    fs.readFile(path.join(ASSETS, 'fonts', 'LibreBaskerville-Regular.ttf')),
  ]);
  // Plain Uint8Array copies: pdf-lib type-checks its input, and a Node Buffer
  // from another realm (as under a test DOM) would not pass.
  const doc = await PDFDocument.load(new Uint8Array(templateBytes));
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(new Uint8Array(fontBytes), { subset: true });
  const page = doc.getPage(0);
  const { width, height } = page.getSize();

  const line = envelopeNameLine(name);
  const size = envelopeNameFontSize((s) => font.widthOfTextAtSize(line, s), width);
  const textWidth = font.widthOfTextAtSize(line, size);

  page.drawText(line, {
    x: (width - textWidth) / 2,
    y: height - ENVELOPE_NAME_LAYOUT.baselineFromTopPt,
    size,
    font,
    color: rgb(0, 0, 0),
  });
  doc.setTitle(`Envelope — ${name}`);
  return doc.save();
}

// ---------------------------------------------------------------------------
// Certificate of Cremation
// ---------------------------------------------------------------------------

export type CertificateValues = {
  tagNumber: string | null;
  decedentDisplayName: string;
  /** Already formatted for print, e.g. "October 9, 2026". */
  dateOfDeath: string | null;
  dateOfCremation: string;
};

/**
 * The official form's two date fields are named the WRONG way round: the
 * field called "DateOfCremation" sits beside the "Date of Death:" label and
 * "DateOfDeath" beside "Date of Cremation:" (verified by filling each with
 * its own name and rendering it). Filling by name would print each date
 * against the other's label, so the dates are placed by POSITION: the upper
 * of the two fields is the one beside "Date of Death:", which the template
 * prints above "Date of Cremation:".
 */
export function dateFieldsByLabel(fields: { name: string; y: number }[]): { dateOfDeathField: string; dateOfCremationField: string } {
  const dates = fields.filter((f) => f.name === 'DateOfDeath' || f.name === 'DateOfCremation');
  if (dates.length !== 2) throw new OfficialTemplateError('The Certificate of Cremation template does not have its two date fields.');
  const [upper, lower] = [...dates].sort((a, b) => b.y - a.y);
  return { dateOfDeathField: upper.name, dateOfCremationField: lower.name };
}

export async function buildCertificateOfCremationPdf(templateBytes: Uint8Array, values: CertificateValues): Promise<Uint8Array> {
  const name = values.decedentDisplayName.trim();
  if (!name) throw new OfficialTemplateError('The certificate needs the decedent\'s name.');
  if (!values.dateOfCremation.trim()) throw new OfficialTemplateError('The certificate needs the date of cremation.');

  const doc = await PDFDocument.load(new Uint8Array(templateBytes));
  const form = doc.getForm();
  const textField = (fieldName: string): PDFTextField => {
    try {
      return form.getTextField(fieldName);
    } catch {
      throw new OfficialTemplateError(`The Certificate of Cremation template has no "${fieldName}" field.`);
    }
  };

  const { dateOfDeathField, dateOfCremationField } = dateFieldsByLabel(
    ['DateOfDeath', 'DateOfCremation'].map((fieldName) => ({ name: fieldName, y: textField(fieldName).acroField.getWidgets()[0].getRectangle().y })),
  );

  const [timesBold, timesRoman] = await Promise.all([doc.embedFont(StandardFonts.TimesRomanBold), doc.embedFont(StandardFonts.TimesRoman)]);
  const fill = (fieldName: string, value: string, font: typeof timesBold, size: number) => {
    const field = textField(fieldName);
    field.setText(value);
    field.setFontSize(size);
    field.updateAppearances(font);
  };

  // The template's own declared fonts and sizes (its fields' /DA). The
  // single-line fields begin exactly where their printed labels end, so a
  // value gets one leading space rather than touching "Tag Number:".
  const afterLabel = (value: string | null | undefined) => (value?.trim() ? ` ${value.trim()}` : '');
  fill('TagNumber', afterLabel(values.tagNumber), timesBold, 14);
  fill('Name', name, timesBold, 14);
  fill(dateOfDeathField, afterLabel(values.dateOfDeath), timesRoman, 13);
  fill(dateOfCremationField, afterLabel(values.dateOfCremation), timesRoman, 13);

  // On-screen buttons in the original; not printable there, removed here
  // before flattening so they never become part of the page.
  for (const field of form.getFields()) {
    if (field instanceof PDFButton) form.removeField(field);
  }
  form.flatten();
  doc.setTitle(`Certificate of Cremation — ${name}`);
  return doc.save();
}

export class OfficialTemplateError extends Error {}
