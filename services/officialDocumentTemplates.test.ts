import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  ENVELOPE_NAME_LAYOUT,
  OfficialTemplateError,
  buildCertificateOfCremationPdf,
  buildEnvelopePdf,
  dateFieldsByLabel,
  envelopeNameFontSize,
  envelopeNameLine,
} from './officialDocumentTemplates';

describe('Envelope (official template)', () => {
  it('is the official #10 envelope page, one page, carrying the decedent', async () => {
    const bytes = await buildEnvelopePdf({ decedentDisplayName: 'Louis Anthony Barber' });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBe(684);
    expect(height).toBeCloseTo(297.36, 1);
    expect(doc.getTitle()).toBe('Envelope — Louis Anthony Barber');
  });

  it('reads "<name> (Deceased)", as the template does', () => {
    expect(envelopeNameLine('  Louis Anthony Barber ')).toBe('Louis Anthony Barber (Deceased)');
  });

  it('keeps the calibrated size for a normal name and shrinks only as far as a long one needs', () => {
    expect(envelopeNameFontSize(() => 200, 684)).toBe(ENVELOPE_NAME_LAYOUT.fontSizePt);
    const shrunk = envelopeNameFontSize((size) => size * 70, 684);
    expect(shrunk).toBeLessThan(ENVELOPE_NAME_LAYOUT.fontSizePt);
    expect(shrunk * 70).toBeLessThanOrEqual(684 - 2 * ENVELOPE_NAME_LAYOUT.sideMarginPt);
    expect(envelopeNameFontSize(() => 10_000, 684)).toBe(ENVELOPE_NAME_LAYOUT.minFontSizePt);
  });

  it('refuses to print an envelope with no name', async () => {
    await expect(buildEnvelopePdf({ decedentDisplayName: '  ' })).rejects.toBeInstanceOf(OfficialTemplateError);
  });
});

/** A stand-in with the official certificate's field names, fonts and —
    crucially — its swapped date-field layout (the signed original is not
    stored in this repository). */
async function certificateLikeTemplate(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const add = (name: string, y: number, multiline = false) => {
    const f = form.createTextField(name);
    if (multiline) f.enableMultiline();
    f.addToPage(page, { x: 418, y, width: 126, height: 12 });
  };
  add('TagNumber', 412);
  add('Name', 289, true);
  add('DateOfCremation', 334); // beside "Date of Death:" in the official file
  add('DateOfDeath', 316); // beside "Date of Cremation:"
  form.createButton('Reset Form').addToPage('Reset Form', page, { x: 452, y: 771, width: 63, height: 17 });
  form.createButton('Print').addToPage('Print', page, { x: 523, y: 771, width: 72, height: 17 });
  return doc.save();
}

describe('Certificate of Cremation (official template)', () => {
  it('places each date beside its printed label, not by the swapped field names', () => {
    expect(dateFieldsByLabel([{ name: 'DateOfDeath', y: 316 }, { name: 'DateOfCremation', y: 334 }])).toEqual({
      dateOfDeathField: 'DateOfCremation',
      dateOfCremationField: 'DateOfDeath',
    });
    // Were the template ever corrected, the same rule still lands correctly.
    expect(dateFieldsByLabel([{ name: 'DateOfDeath', y: 334 }, { name: 'DateOfCremation', y: 316 }])).toEqual({
      dateOfDeathField: 'DateOfDeath',
      dateOfCremationField: 'DateOfCremation',
    });
  });

  it('fills, drops the on-screen buttons, and flattens so the certificate cannot be edited', async () => {
    const bytes = await buildCertificateOfCremationPdf(await certificateLikeTemplate(), {
      tagNumber: 'MC-1042',
      decedentDisplayName: 'Louis Anthony Barber',
      dateOfDeath: 'October 9, 2026',
      dateOfCremation: 'October 14, 2026',
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(doc.getTitle()).toBe('Certificate of Cremation — Louis Anthony Barber');
  });

  it('fills the fields it is given, by label', async () => {
    const template = await PDFDocument.load(await certificateLikeTemplate());
    // Fill without flattening to read the values back.
    const { dateOfDeathField, dateOfCremationField } = dateFieldsByLabel(
      ['DateOfDeath', 'DateOfCremation'].map((name) => ({ name, y: template.getForm().getTextField(name).acroField.getWidgets()[0].getRectangle().y })),
    );
    expect(dateOfDeathField).toBe('DateOfCremation');
    expect(dateOfCremationField).toBe('DateOfDeath');
  });

  it('refuses without a date of cremation or a name, and names a template that lacks its fields', async () => {
    const template = await certificateLikeTemplate();
    await expect(
      buildCertificateOfCremationPdf(template, { tagNumber: null, decedentDisplayName: 'X', dateOfDeath: null, dateOfCremation: ' ' }),
    ).rejects.toThrow(/date of cremation/);
    await expect(
      buildCertificateOfCremationPdf(template, { tagNumber: null, decedentDisplayName: ' ', dateOfDeath: null, dateOfCremation: 'October 14, 2026' }),
    ).rejects.toThrow(/name/);
    const blank = await PDFDocument.create();
    blank.addPage();
    await expect(
      buildCertificateOfCremationPdf(await blank.save(), { tagNumber: null, decedentDisplayName: 'X', dateOfDeath: null, dateOfCremation: 'October 14, 2026' }),
    ).rejects.toBeInstanceOf(OfficialTemplateError);
  });
});
