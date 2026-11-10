import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { dymoLabelPrintHtml, readDymoLabelObjects } from './dymoLabelPrintHtml';
import { fillManorsLabel } from './manorsLabel';

/** 2026-11: Print without DYMO Connect draws the saved label file itself. */
describe('dymoLabelPrintHtml', () => {
  const xml = fillManorsLabel({ name: 'Jane Q. Sample', tag: 'Tag #12345', date: 'November 6, 2026' });

  it('reads every object of the approved template — logo, letterhead and the three case values', () => {
    const objects = readDymoLabelObjects(xml);
    expect(objects.map((o) => o.kind)).toEqual(['image', 'text', 'text', 'text', 'text']);
    const texts = objects.flatMap((o) => (o.kind === 'text' ? o.lines.map((l) => l.text) : []));
    expect(texts).toEqual(['Manors Cremation', '481 E. Commercial Blvd.', 'Oakland Park, FL 33334', '954-884-5770', 'Jane Q. Sample', 'Tag #12345', 'November 6, 2026', '']);
    // (The template's Tag/date box ends with an empty line, kept so the two lines sit where DYMO puts them.)
    const name = objects[3];
    expect(name).toMatchObject({ kind: 'text', horizontal: 'center' });
    expect(name.kind === 'text' && name.lines[0]).toMatchObject({ fontName: 'Times New Roman', fontSizePt: 21.1, bold: true });
  });

  it('is a self-contained page at the label size, with nothing fetched from the network', () => {
    const html = dymoLabelPrintHtml(xml, 'Cremation Label v1');
    expect(html).toContain('@page { size: 4in 2.125in; margin: 0; }');
    expect(html).toContain('src="data:image/png;base64,iVBOR');
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).toContain('Jane Q. Sample');
    if (process.env.LABEL_PRINT_PREVIEW_OUT) writeFileSync(process.env.LABEL_PRINT_PREVIEW_OUT, html);
  });

  it('escapes the case values', () => {
    const html = dymoLabelPrintHtml(fillManorsLabel({ name: '<b>O&apos;Neil</b>', tag: 'Tag #1', date: 'November 6, 2026' }), 't');
    expect(html).not.toContain('<b>O');
    expect(html).toContain('&lt;b&gt;');
  });

  it('refuses a file that is not a DYMO label', () => {
    expect(() => readDymoLabelObjects('<html></html>')).toThrow('could not be read');
  });
});
