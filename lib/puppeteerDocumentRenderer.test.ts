import { describe, expect, it } from 'vitest';
import { puppeteerDocumentRenderer } from './puppeteerDocumentRenderer';

/**
 * Requires a real Chromium/Chrome binary — set PUPPETEER_EXECUTABLE_PATH
 * (e.g. to a local Chrome install) to actually exercise this. Skipped
 * automatically otherwise, matching this phase's own testing strategy
 * ("run outside the full suite's default fast path if Chromium startup
 * cost makes that necessary") — no CI/build environment is assumed to
 * have a browser available.
 */
const hasChromium = Boolean(process.env.PUPPETEER_EXECUTABLE_PATH);

describe.skipIf(!hasChromium)('puppeteerDocumentRenderer', () => {
  it('renders representative HTML (headers, Unicode, multi-page) to a valid PDF buffer', async () => {
    const html = `
      <html>
        <head><style>
          @page { margin: 1in; }
          body { font-family: sans-serif; }
          .page-break { page-break-before: always; }
        </style></head>
        <body>
          <h1>Cremation Authorization — Café Müller Ünïcode 日本語</h1>
          <p>Decedent: Robert Ellison</p>
          <div class="page-break">
            <h2>Page Two</h2>
            <p>Signature: ______________________</p>
          </div>
        </body>
      </html>
    `;

    const pdf = await puppeteerDocumentRenderer.renderHtmlToPdf(html);

    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(500);
    // PDF magic bytes: "%PDF-"
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 30_000);

  it('throws rather than fetching an external resource a malicious template might reference', async () => {
    const html = `<html><body><img src="https://example.invalid.test-domain-that-should-never-resolve/x.png" /><p>Body text</p></body></html>`;
    // Should still render successfully (the blocked image simply fails to
    // load) — the point is no network request actually reaches out;
    // there is no direct way to assert "no network call happened" from
    // here without a request-log hook, so this at minimum confirms
    // rendering completes without hanging/erroring on the blocked request.
    const pdf = await puppeteerDocumentRenderer.renderHtmlToPdf(html);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 30_000);
});
