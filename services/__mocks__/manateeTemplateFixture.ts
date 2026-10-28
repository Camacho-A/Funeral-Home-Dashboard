import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * A stand-in for Manors' Manatee County form (DH 1961) for tests: the same
 * field names, list options and prefilled values as the real template, on a
 * blank page with a little printed text. The real form carries a signature
 * and is never in the repository.
 */
export async function buildManateeTemplateFixture(options: { price?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('APPLICATION FOR A FLORIDA DEATH RECORD (test stand-in)', { x: 120, y: 740, size: 12, font });
  page.drawText('FedEx fee   $15.00', { x: 30, y: 82, size: 9, font });
  const form = doc.getForm();
  let y = 700;
  const text = (name: string, value = '') => {
    const field = form.createTextField(name);
    field.addToPage(page, { x: 150, y: (y -= 17), width: 150, height: 15, font });
    if (value) field.setText(value);
    return field;
  };
  const list = (name: string, choices: string[]) => {
    const field = form.createDropdown(name);
    field.addOptions(choices);
    field.enableEditing();
    field.addToPage(page, { x: 320, y: (y -= 17), width: 150, height: 15, font });
    return field;
  };
  ['1 OF', 'of', 'First Name', 'Middle', 'Last', 'Suffix1', 'Alias', 'Surname'].forEach((n) => text(n));
  list('Suffix2', ['   ', 'F', 'M']);
  list('Month', ['   ', ...Array.from({ length: 12 }, (_, i) => String(i + 1))]);
  list('Day', ['   ', ...Array.from({ length: 31 }, (_, i) => String(i + 1))]);
  list('Year', ['   ', '2020', '2021', '2022', '2023', '2024', '2025']);
  text('Range of Years', 'N/A');
  list('Place of Death', ['   ', 'FORT LAUDERDALE', 'MIAMI', 'PEMBROKE PINES      ', 'WESTON']);
  list('County', ['   ', 'BROWARD', 'MIAMI-DADE', 'MONROE']);
  ['State File', 'First Name2', 'Middle2', 'Last2', 'Suffix3', 'SS'].forEach((n) => text(n));
  text('FuneralHome DBA 2', 'MANORS CREMATION');
  text('First, Last, Middle', 'GUS CAMACHO JR.');
  text('CA Relationship', 'FUNERAL DIRECTOR');
  text('Zip2', '33334');
  text('State2', 'FLORIDA');
  text('City2', 'OAKLAND PARK');
  text('License', 'F019712');
  text('Represented');
  list('Relationship', ['   ', 'Brother', 'Daughter', 'Father', 'Mother', 'Son', 'Spouse']);
  text('Text1');
  text('price1', options.price ?? '$8.00');
  text('Text3', '0.00');
  text('Text2');
  text('price2', options.price ?? '$8.00');
  text('Text4', '0.00');
  text('Text5', 'ON FILE');
  text('Text8', '0.00');
  return doc.save();
}
