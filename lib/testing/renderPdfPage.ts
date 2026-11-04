/**
 * Tests only: renders one PDF page to RGBA pixels (pdfjs-dist + @napi-rs/canvas)
 * so a test can compare what two PDFs actually look like, pixel for pixel.
 */
export async function renderPdfPage(bytes: Uint8Array, pageNumber: number, scale = 2): Promise<{ width: number; height: number; data: Uint8ClampedArray; png: () => Buffer }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');
  const path = await import('node:path');
  const fonts = `${path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts')}/`;
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, standardFontDataUrl: fonts });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: image.data, png: () => canvas.toBuffer('image/png') };
  } finally {
    await task.destroy();
  }
}

/** Pixels that differ (any channel by more than `threshold`) outside the given PDF-point rectangles. */
export function differingPixelsOutside(
  a: { width: number; height: number; data: Uint8ClampedArray },
  b: { width: number; height: number; data: Uint8ClampedArray },
  excluded: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  pageHeightPoints: number,
  scale = 2,
  threshold = 24,
): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  const margin = 2 * scale;
  const boxes = excluded.map((r) => ({
    left: r.x * scale - margin,
    right: (r.x + r.width) * scale + margin,
    top: (pageHeightPoints - r.y - r.height) * scale - margin,
    bottom: (pageHeightPoints - r.y) * scale + margin,
  }));
  let differing = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (boxes.some((box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) continue;
      const i = (y * a.width + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) > threshold || Math.abs(a.data[i + 1] - b.data[i + 1]) > threshold || Math.abs(a.data[i + 2] - b.data[i + 2]) > threshold) differing++;
    }
  }
  return differing;
}
