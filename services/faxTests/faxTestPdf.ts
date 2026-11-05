import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * The fictional test PDF: US Letter, "SOLIS FAX TEST / PAGE n OF N" and a
 * large n/N mark on each page, no case or personal data. Built without
 * dates or a producer, so the bytes — and checksum — are always the same.
 */
export async function buildFaxTestPdf(pages: 1 | 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= pages; p++) {
    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 36, y: 36, width: 540, height: 720, borderColor: rgb(0, 0, 0), borderWidth: 3 });
    page.drawText('SOLIS FAX TEST', { x: 72, y: 660, size: 48, font: bold });
    page.drawText(`PAGE ${p} OF ${pages}`, { x: 72, y: 590, size: 40, font: bold });
    [
      'This is a test transmission from SOLIS.',
      'It is NOT a death certificate application and contains no case data.',
      'If you received this fax in error, please discard it.',
      '',
      `Expected total: ${pages} page${pages > 1 ? 's' : ''}. Any extra page was added in transit`,
      '(cover page, email text, signature or disclaimer).',
    ].forEach((line, i) => page.drawText(line, { x: 72, y: 520 - i * 22, size: 14, font }));
    page.drawText(`${p}/${pages}`, { x: 430, y: 80, size: 72, font: bold });
  }
  return doc.save({ useObjectStreams: false });
}
