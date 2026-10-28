import fs from 'fs/promises';
import { PDFDocument, PDFDropdown, PDFTextField, StandardFonts, TextAlignment } from 'pdf-lib';
import {
  FEDEX_ENTRY_BOXES,
  PRINTED_PRICE_TEXT,
  fedexEntries,
  manateeFieldValues,
  manateeIssues,
  type ManateeApplicationValues,
} from '../domain/documents/manateeDeathCertificateApplication';
import { DocumentNotFoundError } from '../lib/documentStorageProvider';
import { downloadOrgDocumentBytes } from './documentService';

/**
 * Manatee County — Death Certificate Application: the template and the fill
 * (2026-10). See domain/documents/manateeDeathCertificateApplication.ts for
 * the rules.
 *
 * The template is Manors' own copy of form DH 1961, prefilled with Manors'
 * applicant details and carrying a real signature, so — like the signed
 * Certificate of Cremation — it is NOT stored in this (public) repository.
 * It is read from the organization's private document storage, at the key
 * in MANATEE_DC_APPLICATION_TEMPLATE_STORAGE_KEY, or for local development
 * from a file (MANATEE_DC_APPLICATION_TEMPLATE_PATH). Without either the
 * document is reported as unavailable, never approximated.
 */

export type ManateeTemplate = { status: 'loaded'; bytes: Uint8Array } | { status: 'not_configured' } | { status: 'not_found' };

export async function loadManateeApplicationTemplate(): Promise<ManateeTemplate> {
  const storageKey = process.env.MANATEE_DC_APPLICATION_TEMPLATE_STORAGE_KEY?.trim();
  if (storageKey) {
    try {
      return { status: 'loaded', bytes: new Uint8Array((await downloadOrgDocumentBytes(storageKey)).buffer) };
    } catch (error) {
      if (error instanceof DocumentNotFoundError) return { status: 'not_found' };
      throw error;
    }
  }
  const localPath = process.env.MANATEE_DC_APPLICATION_TEMPLATE_PATH?.trim();
  if (localPath) return { status: 'loaded', bytes: new Uint8Array(await fs.readFile(localPath)) };
  return { status: 'not_configured' };
}

export class ManateeTemplateError extends Error {}

/**
 * The template with this case's values in its own fields — and nothing
 * else changed — then flattened, so the saved application cannot be
 * edited (a correction is a new version made through SOLIS). Only the
 * fields this case fills are set and redrawn; every other field (the
 * prefilled applicant, prices, "ON FILE") keeps its original value and
 * appearance. With the FedEx fee confirmed, "1" and "15.00" are set in the
 * FedEx row's blank quantity and total spaces, exactly as the certificate
 * rows above them are; without it the row stays blank. The template bytes
 * passed in are never modified.
 *
 * Text is drawn in Helvetica (bold where the form declares bold), the
 * standard-PDF equivalent of the Arial the form declares (Arial is not
 * embedded in the template), at the form's own 9 pt.
 */
export async function buildManateeApplicationPdf(
  templateBytes: Uint8Array,
  values: ManateeApplicationValues,
  /** Tests only: keep the form fillable to inspect each field. */
  options: { flatten?: boolean } = {},
): Promise<Uint8Array> {
  if (manateeIssues(values).length > 0) throw new ManateeTemplateError('The application still has information to complete.');

  const doc = await PDFDocument.load(new Uint8Array(templateBytes));
  const form = doc.getForm();
  const field = (name: string) => {
    try {
      return form.getField(name);
    } catch {
      throw new ManateeTemplateError(`The Manatee County template has no "${name}" field.`);
    }
  };

  // The printed prices the totals are calculated from must still be the
  // form's $8.00 — a changed template is refused, never silently mispriced.
  for (const priceField of ['price1', 'price2']) {
    const price = field(priceField);
    if (!(price instanceof PDFTextField) || price.getText()?.trim() !== PRINTED_PRICE_TEXT) {
      throw new ManateeTemplateError('The Manatee County template no longer shows $8.00 per certificate.');
    }
  }

  const [regular, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  const fieldValues = manateeFieldValues(values);
  for (const [name, value] of Object.entries(fieldValues)) {
    const target = field(name);
    if (target instanceof PDFTextField) {
      target.setText(value);
    } else if (target instanceof PDFDropdown) {
      // The form's own option when it has one ("PEMBROKE PINES      ", "Son");
      // otherwise the value itself — every list on this form is editable
      // (its Year list stops at 2025).
      const option = target.getOptions().find((o) => o.trim().toUpperCase() === value.trim().toUpperCase() && value.trim() !== '');
      if (value.trim() === '') target.clear();
      else target.select(option ?? value);
    } else {
      throw new ManateeTemplateError(`The Manatee County template's "${name}" field is not a text or list field.`);
    }
    // Bold where the form declares bold (the Grand Total).
    const declaresBold = /Bold/.test(target.acroField.getDefaultAppearance() ?? '');
    target.updateAppearances(declaresBold ? bold : regular);
  }

  const fedex = fedexEntries(values.fedexFee);
  if (fedex) {
    const page = doc.getPages()[0];
    for (const [key, text] of [['quantity', fedex.quantity], ['total', fedex.total]] as const) {
      // A field of the same size and style as the certificate rows' own
      // (Text1 / Text3), so the entry matches them; it becomes part of the
      // page when the form is flattened below.
      const entry = form.createTextField(`solis.fedex.${key}`);
      entry.addToPage(page, { ...FEDEX_ENTRY_BOXES[key], font: regular, borderWidth: 0, backgroundColor: undefined, borderColor: undefined });
      entry.setAlignment(TextAlignment.Center);
      entry.setFontSize(9);
      entry.setText(text);
      entry.updateAppearances(regular);
    }
  }

  doc.setTitle('Application for a Florida Death Record — Manatee County');
  // Appearances were drawn above for exactly the filled fields; every other
  // field is flattened with its own original appearance.
  if (options.flatten !== false) form.flatten({ updateFieldAppearances: false });
  return doc.save({ updateFieldAppearances: false });
}
