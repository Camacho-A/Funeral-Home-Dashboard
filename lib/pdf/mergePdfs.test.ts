import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, type PDFPage } from 'pdf-lib';
import { mergePdfs, UnreadablePdfError } from './mergePdfs';

/** Send to Crematory (2026-10). Fictional PDFs only. */
const SIGNATURE_PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

async function pdf(label: string, pages: number, size: [number, number] = [612, 792]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const signature = await doc.embedPng(SIGNATURE_PNG);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage(size);
    page.drawText(`${label} ${n}`, { x: 50, y: 50, size: 12, font });
    page.drawImage(signature, { x: 50, y: 100, width: 80, height: 30 });
  }
  return new Uint8Array(await doc.save());
}

const load = (bytes: Uint8Array) => PDFDocument.load(new Uint8Array(bytes));
const content = (page: PDFPage) => {
  const ref = page.node.get(PDFName.of('Contents'));
  const streams = ref && 'asArray' in (page.doc.context.lookup(ref) as object) ? (page.doc.context.lookup(ref) as unknown as { asArray(): unknown[] }).asArray() : [ref];
  return streams.map((r) => Buffer.from((page.doc.context.lookup(r as never) as PDFRawStream).getContents()).toString('hex')).join('|');
};

describe('mergePdfs', () => {
  it('keeps every page of each part, in order, unchanged — and repeats byte for byte', async () => {
    const permit = await pdf('PERMIT', 2, [612, 1008]);
    const form = await pdf('FORM', 1);
    const { bytes, pageCounts } = await mergePdfs([
      { label: 'State permit', bytes: permit },
      { label: 'Arrangement Form page 3', bytes: form },
    ]);
    expect(pageCounts).toEqual([2, 1]);
    const merged = await load(bytes);
    const [p, f] = [await load(permit), await load(form)];
    expect(merged.getPageCount()).toBe(3);
    expect(content(merged.getPage(0))).toBe(content(p.getPage(0)));
    expect(content(merged.getPage(1))).toBe(content(p.getPage(1)));
    expect(content(merged.getPage(2))).toBe(content(f.getPage(0)));
    expect(merged.getPage(0).getSize()).toEqual({ width: 612, height: 1008 }); // the permit's own size is kept
    const again = await mergePdfs([
      { label: 'State permit', bytes: permit },
      { label: 'Arrangement Form page 3', bytes: form },
    ]);
    expect(Buffer.from(again.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it('names the part that is not a readable PDF', async () => {
    await expect(mergePdfs([{ label: 'State permit', bytes: new Uint8Array(Buffer.from('not a pdf')) }])).rejects.toEqual(new UnreadablePdfError('State permit'));
  });
});
