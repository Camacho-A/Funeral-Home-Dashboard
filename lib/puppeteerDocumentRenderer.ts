import puppeteer from 'puppeteer-core';
import type { DocumentRenderer } from './documentRenderer';

/**
 * Phase 25 (Document Generation & Template Management). The one real
 * `DocumentRenderer` implementation — headless Chromium via
 * `puppeteer-core`, chosen over a component-based PDF library
 * (`@react-pdf/renderer`) specifically so the exact same HTML that
 * renders as a template's live in-browser preview also produces the
 * final PDF (true WYSIWYG parity), with full CSS page-layout and Unicode
 * support. See docs/adr/ADR-029-document-generation-and-template-management.md.
 *
 * Two execution environments, one interface:
 * - **Serverless (Vercel)**: `@sparticuz/chromium` supplies a Chromium
 *   binary built for exactly this constraint (small enough for a
 *   serverless function bundle), detected via `VERCEL`/`AWS_LAMBDA_*`
 *   env vars Vercel itself sets.
 * - **Local development / any environment with a real browser already
 *   installed**: `PUPPETEER_EXECUTABLE_PATH` names the binary to launch
 *   directly (e.g. a local Chrome install) — never guessed or
 *   hardcoded to one OS's install path, since dev machines vary.
 *
 * Neither path is silently assumed: if neither applies, `renderHtmlToPdf`
 * throws a clear error naming which env var to set, matching
 * `lib/clover/cloverConfig.ts`'s "fail clearly" convention.
 */

async function resolveLaunchOptions(): Promise<{ executablePath: string; args: string[] }> {
  const explicitPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicitPath) {
    return { executablePath: explicitPath, args: [] };
  }

  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION);
  if (isServerless) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return { executablePath: await chromium.executablePath(), args: chromium.args };
  }

  throw new Error(
    'Document rendering is not configured: no PDF-capable Chromium binary was found. ' +
      'Set PUPPETEER_EXECUTABLE_PATH to a local Chrome/Chromium binary for development, ' +
      'or deploy to an environment where VERCEL or AWS_LAMBDA_FUNCTION_VERSION is set ' +
      'so @sparticuz/chromium is used automatically.',
  );
}

export const puppeteerDocumentRenderer: DocumentRenderer = {
  async renderHtmlToPdf(html: string): Promise<Buffer> {
    const { executablePath, args } = await resolveLaunchOptions();
    const browser = await puppeteer.launch({ executablePath, args, headless: true });
    try {
      const page = await browser.newPage();
      // Network-locked: every request except `data:` URIs (inline
      // base64 assets a template body may embed) and the initial blank
      // page is aborted — defense-in-depth against a malicious or
      // compromised template body reaching out over the network (e.g.
      // probing an internal address via an <img> tag) during server-side
      // rendering. See this phase's Security section.
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = request.url();
        if (url.startsWith('data:') || url === 'about:blank') {
          request.continue();
          return;
        }
        request.abort();
      });
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'letter', printBackground: true });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  },
};
