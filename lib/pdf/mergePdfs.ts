import { PDFDocument } from 'pdf-lib';

/**
 * Joins whole PDFs into one, in order — every page copied with its own
 * content and images exactly as they are (signatures, stamps, seals), never
 * redrawn. No metadata (dates, producer) is added, so the same inputs always
 * produce the same bytes: a package rebuilt from unchanged sources is
 * recognisably identical.
 *
 * Throws `UnreadablePdfError` naming the input that could not be read.
 */
export class UnreadablePdfError extends Error {
  constructor(readonly label: string) {
    super(`${label} is not a readable PDF.`);
    this.name = 'UnreadablePdfError';
  }
}

export async function mergePdfs(parts: ReadonlyArray<{ label: string; bytes: Uint8Array }>): Promise<{ bytes: Uint8Array; pageCounts: number[] }> {
  const output = await PDFDocument.create({ updateMetadata: false });
  const pageCounts: number[] = [];
  for (const part of parts) {
    let source: PDFDocument;
    try {
      source = await PDFDocument.load(new Uint8Array(part.bytes), { updateMetadata: false });
    } catch {
      throw new UnreadablePdfError(part.label);
    }
    const pages = await output.copyPages(source, source.getPageIndices());
    if (pages.length === 0) throw new UnreadablePdfError(part.label);
    pages.forEach((page) => output.addPage(page));
    pageCounts.push(pages.length);
  }
  return { bytes: await output.save(), pageCounts };
}
