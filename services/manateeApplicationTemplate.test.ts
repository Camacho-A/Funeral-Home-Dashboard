import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFDropdown, PDFTextField, decodePDFRawStream, PDFRawStream } from 'pdf-lib';
import { buildManateeApplicationPdf, ManateeTemplateError } from './manateeApplicationTemplate';
import { buildManateeTemplateFixture } from './__mocks__/manateeTemplateFixture';
import { MANATEE_FILLED_FIELD_NAMES, type ManateeApplicationValues } from '@/domain/documents/manateeDeathCertificateApplication';

/** Fictional. The real form (with its signature) is verified outside the
    repository; this stand-in has the same fields, lists and prefills. */
const values: ManateeApplicationValues = {
  decedentFirst: 'Mary Ann',
  decedentMiddle: 'Louise',
  decedentLast: 'Salas Rueda',
  ssn: '000123456',
  ssnNotKnown: false,
  dateOfDeath: '10/04/2026',
  placeOfDeathCity: 'Pembroke Pines',
  placeOfDeathCounty: 'Broward',
  spouseFirst: 'Jonathan',
  spouseMiddle: '',
  spouseLast: 'Salas Rueda',
  representedName: 'Teresa Salas Rueda',
  representedRelationship: 'Daughter',
  withCause: 2,
  withoutCause: 3,
  fedexFee: true,
};

const read = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  const fields = new Map<string, string>();
  for (const f of doc.getForm().getFields()) {
    fields.set(f.getName(), f instanceof PDFTextField ? (f.getText() ?? '') : f instanceof PDFDropdown ? f.getSelected().join('|') : '');
  }
  const appearance = (name: string) => {
    const stream = doc.context.lookup(doc.getForm().getField(name).acroField.getWidgets()[0].getNormalAppearance());
    return stream instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1') : String(stream);
  };
  const content = () => {
    const contents = doc.getPages()[0].node.Contents()!;
    const streams = 'asArray' in contents ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    return streams.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('\n');
  };
  return { doc, fields, appearance, content };
};

describe('buildManateeApplicationPdf', () => {
  it('fills exactly the intended fields with the reviewed values', async () => {
    const filled = await read(await buildManateeApplicationPdf(await buildManateeTemplateFixture(), values));
    expect(Object.fromEntries(MANATEE_FILLED_FIELD_NAMES.map((n) => [n, filled.fields.get(n)]))).toEqual({
      'First Name': 'MARY ANN',
      Middle: 'LOUISE',
      Last: 'SALAS RUEDA',
      SS: '000-12-3456',
      Month: '10',
      Day: '4',
      // The form's Year list stops at 2025; its lists are editable.
      Year: '2026',
      // The form's own option, trailing spaces and all.
      'Place of Death': 'PEMBROKE PINES      ',
      County: 'BROWARD',
      'First Name2': 'JONATHAN',
      Middle2: '',
      Last2: 'SALAS RUEDA',
      Represented: 'TERESA SALAS RUEDA',
      Relationship: 'Daughter',
      Text1: '2',
      Text2: '3',
      Text3: '16.00',
      Text4: '24.00',
      Text8: '55.00',
    });
  });

  it('changes nothing else: the page, and every other field\'s value and appearance, are identical to the template', async () => {
    const templateBytes = await buildManateeTemplateFixture();
    const [original, filled] = await Promise.all([read(templateBytes), read(await buildManateeApplicationPdf(templateBytes, values))]);
    expect(filled.content()).toBe(original.content());
    expect([...filled.fields.keys()].sort()).toEqual([...original.fields.keys()].sort());
    const untouched = [...original.fields.keys()].filter((n) => !MANATEE_FILLED_FIELD_NAMES.includes(n));
    expect(untouched).toHaveLength(19);
    for (const name of untouched) {
      expect(filled.fields.get(name), name).toBe(original.fields.get(name));
      expect(filled.appearance(name), name).toBe(original.appearance(name));
    }
    expect(filled.fields.get('First, Last, Middle')).toBe('GUS CAMACHO JR.');
    expect(filled.fields.get('price1')).toBe('$8.00');
  });

  it('the form stays fillable, as the original is', async () => {
    const filled = await read(await buildManateeApplicationPdf(await buildManateeTemplateFixture(), values));
    expect(filled.doc.getForm().getFields().length).toBe(38);
  });

  it('does not touch the template it was given', async () => {
    const template = await buildManateeTemplateFixture();
    const copy = new Uint8Array(template);
    await buildManateeApplicationPdf(template, values);
    expect(Buffer.compare(Buffer.from(template), Buffer.from(copy))).toBe(0);
  });

  it('refuses a template whose printed price is no longer $8.00 — never silently mispriced', async () => {
    await expect(buildManateeApplicationPdf(await buildManateeTemplateFixture({ price: '$10.00' }), values)).rejects.toThrow(ManateeTemplateError);
  });

  it('refuses values that still need review — never a form with blanks guessed over', async () => {
    await expect(buildManateeApplicationPdf(await buildManateeTemplateFixture(), { ...values, decedentLast: '' })).rejects.toThrow('still has information to complete');
  });
});
