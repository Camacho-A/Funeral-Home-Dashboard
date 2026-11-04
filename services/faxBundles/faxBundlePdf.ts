import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, StandardFonts, decodePDFRawStream, rgb, type PDFPage } from 'pdf-lib';
import type { RequestNumbering } from '@/domain/faxBundles/faxBundle';

/**
 * Manatee County DC application fax bundles (2026-11) — the combined PDF.
 *
 * Every saved application is copied page for page, unscaled and uncropped,
 * in the order staff chose. Its number goes in the form's OWN "Request ___
 * of ___" boxes (fields `1 OF` and `of` on DH 1961) — never over any other
 * content. Only the bundle copy is numbered; the saved application is
 * never changed.
 *
 * A saved application is flattened (manateeApplicationTemplate.ts): each
 * form field became its own drawing (a Form XObject) placed exactly at the
 * field's rectangle and clipped to it. The two Request boxes are found as
 * the drawings placed at exactly those rectangles — with exactly that
 * size, or (a box left blank) an empty, zero-size drawing. In the copy, any text in those two drawings is removed (their border,
 * if any, is kept) and the bundle number is written inside them. If the
 * boxes are not found exactly — one drawing each, at the exact position
 * and size — the application is refused, never guessed at.
 */

/** DH 1961's "Request ___ of ___" boxes (PDF points, page 1). */
export const REQUEST_BOXES = [
  { field: '1 OF', x: 473.28, y: 665.7964, width: 25.44, height: 13.6072 },
  { field: 'of', x: 513, y: 665.7964, width: 27.6, height: 13.6072 },
] as const;

const TOLERANCE = 0.01;
const NUMBER_FONT_SIZE = 10;
const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

export class RequestBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestBoxError';
  }
}

type FoundBox = { ref: PDFRef; stream: PDFRawStream; hasText: boolean };

function contentStreams(page: PDFPage): PDFRawStream[] {
  const contents = page.node.Contents();
  if (!contents) return [];
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.map((ref) => page.doc.context.lookup(ref)).filter((s): s is PDFRawStream => s instanceof PDFRawStream);
}

const decoded = (stream: PDFRawStream) => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
/** Whether a drawing shows any text: a non-empty string passed to Tj, ', " or TJ. */
const SHOWN_STRING = String.raw`(?:\((?:\\.|[^\\)])+\)|<[0-9A-Fa-f\s]*[0-9A-Fa-f][0-9A-Fa-f\s]*>)`;
const SHOWS_TEXT = new RegExp(String.raw`${SHOWN_STRING}\s*(?:Tj|'|")|\[[^\]]*${SHOWN_STRING}[^\]]*\]\s*TJ`);
const hasTextOperators = (content: string) => SHOWS_TEXT.test(content);

function bboxOf(stream: PDFRawStream): number[] | null {
  const box = stream.dict.lookup(PDFName.of('BBox'));
  if (!(box instanceof PDFArray) || box.size() !== 4) return null;
  return box.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN));
}

/**
 * Finds the flattened drawing of each Request box on page 1. Throws
 * RequestBoxError unless each box has exactly one drawing at exactly its
 * position and size.
 */
export function findRequestBoxes(doc: PDFDocument): FoundBox[] {
  const page = doc.getPages()[0];
  if (!page) throw new RequestBoxError('The application has no pages.');
  if (doc.getForm().getFields().length > 0) throw new RequestBoxError('The application is not a saved (locked) SOLIS application.');
  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'));
  if (!(xobjects instanceof PDFDict)) throw new RequestBoxError('The "Request ___ of ___" boxes could not be found on the application.');

  const placements: Array<{ name: string; x: number; y: number }> = [];
  const placement = /\bq\s+1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\s+(?:1 0 0 1 0 0 cm\s+)*\/([^\s/]+)\s+Do\b/g;
  for (const stream of contentStreams(page)) {
    const text = decoded(stream);
    for (let m = placement.exec(text); m; m = placement.exec(text)) placements.push({ x: Number(m[1]), y: Number(m[2]), name: m[3] });
  }

  return REQUEST_BOXES.map((box) => {
    const candidates = placements.flatMap((p) => {
      if (!near(p.x, box.x) || !near(p.y, box.y)) return [];
      const ref = xobjects.get(PDFName.of(p.name));
      const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : null;
      if (!(ref instanceof PDFRef) || !(stream instanceof PDFRawStream)) return [];
      const bbox = bboxOf(stream);
      const content = decoded(stream);
      // A box left blank is saved as an empty drawing (zero-size, draws nothing).
      if (bbox && bbox.every((n) => near(n, 0)) && /^(\s*q\s*Q)*\s*$/.test(content)) return [{ ref, stream, hasText: false }];
      if (!bbox || !near(bbox[0], 0) || !near(bbox[1], 0) || !near(bbox[2], box.width) || !near(bbox[3], box.height)) return [];
      return [{ ref, stream, hasText: hasTextOperators(content) }];
    });
    const unique = [...new Map(candidates.map((c) => [c.ref.toString(), c])).values()];
    if (unique.length !== 1) throw new RequestBoxError('The "Request ___ of ___" boxes could not be identified exactly on the application.');
    return unique[0];
  });
}

/** Removes the text from one box's drawing (in this document copy only), keeping everything else it draws. */
function clearBoxText(doc: PDFDocument, box: FoundBox): void {
  const without = decoded(box.stream).replace(/\bBT\b[\s\S]*?\bET\b/g, '');
  const dict = box.stream.dict.clone(doc.context);
  dict.delete(PDFName.of('Filter'));
  dict.delete(PDFName.of('DecodeParms'));
  dict.delete(PDFName.of('Length'));
  doc.context.assign(box.ref, doc.context.flateStream(without, Object.fromEntries(dict.entries().map(([k, v]) => [k.asString().slice(1), v]))));
}

export type BundleApplication = { bytes: Uint8Array };
export type BundledApplication = { pageCount: number; numbering: RequestNumbering };

/** Whether a saved application's Request boxes are blank, or carry numbers that the bundle copy will replace. */
export async function inspectApplication(bytes: Uint8Array): Promise<{ pageCount: number; numbering: RequestNumbering }> {
  const doc = await PDFDocument.load(bytes);
  const boxes = findRequestBoxes(doc);
  return { pageCount: doc.getPageCount(), numbering: boxes.some((b) => b.hasText) ? 'replaced_existing' : 'filled_blank' };
}

/**
 * One PDF of every application, in order, each numbered "n of N" in its
 * own Request boxes. A multi-page application also carries "Request n of
 * N · page k of m" in the empty bottom margin of its later pages, so its
 * pages can never be mistaken for another application's.
 */
export async function buildFaxBundlePdf(applications: readonly BundleApplication[]): Promise<{ bytes: Uint8Array; pageCount: number; applications: BundledApplication[] }> {
  if (applications.length === 0) throw new RequestBoxError('A bundle needs at least one application.');
  const bundle = await PDFDocument.create();
  bundle.setTitle('DC Application Bundle');
  bundle.setProducer('SOLIS');
  bundle.setCreator('SOLIS');
  const font = await bundle.embedFont(StandardFonts.Helvetica);
  const total = applications.length;
  const results: BundledApplication[] = [];

  for (const [index, application] of applications.entries()) {
    const source = await PDFDocument.load(application.bytes);
    const boxes = findRequestBoxes(source);
    const numbering: RequestNumbering = boxes.some((b) => b.hasText) ? 'replaced_existing' : 'filled_blank';
    for (const box of boxes) if (box.hasText) clearBoxText(source, box);

    const pages = await bundle.copyPages(source, source.getPageIndices());
    const n = index + 1;
    pages.forEach((page, pageIndex) => {
      bundle.addPage(page);
      if (pageIndex === 0) {
        for (const [boxIndex, box] of REQUEST_BOXES.entries()) {
          const text = String(boxIndex === 0 ? n : total);
          const width = font.widthOfTextAtSize(text, NUMBER_FONT_SIZE);
          page.drawText(text, {
            x: box.x + (box.width - width) / 2,
            y: box.y + (box.height - font.heightAtSize(NUMBER_FONT_SIZE, { descender: false })) / 2,
            size: NUMBER_FONT_SIZE,
            font,
            color: rgb(0, 0, 0),
          });
        }
      } else {
        const label = `Request ${n} of ${total} · page ${pageIndex + 1} of ${pages.length}`;
        const size = 7;
        const { width: pageWidth } = page.getSize();
        page.drawText(label, { x: pageWidth - 36 - font.widthOfTextAtSize(label, size), y: 12, size, font, color: rgb(0, 0, 0) });
      }
    });
    results.push({ pageCount: pages.length, numbering });
  }

  const bytes = await bundle.save();
  return { bytes, pageCount: bundle.getPageCount(), applications: results };
}
