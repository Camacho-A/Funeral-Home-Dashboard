import puppeteer from 'puppeteer-core';
import type { DocumentRenderer } from './documentRenderer';
import { withTimeout } from './timeLimit';

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

/** Exported for testing only — lets a test exercise the serverless
    (`@sparticuz/chromium`) branch's actual option-resolution logic (env
    var detection, which fields `chromium.executablePath()`/`chromium.args`
    feed into) without launching a real Linux-only Chromium binary on a
    non-Linux dev/CI machine, which would fail for environmental reasons
    unrelated to whether this code is correct. */
export async function resolveLaunchOptions(): Promise<{ executablePath: string; args: string[] }> {
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

/**
 * Hang protection (2026-11). On 2026-11-10 two automatic Statement/Receipt
 * builds started eight seconds apart on B2026-047 (order saved, then a
 * payment recorded). Both hung until Vercel killed the function at 300
 * seconds, so their rows stayed `pending` forever — shown to staff as
 * "Draft" with no file behind them. Nothing was logged, because the
 * process was killed rather than an error thrown.
 *
 * Two guards, so that can't happen again:
 *
 *   - Renders run one at a time per server instance. Fluid compute serves
 *     several requests from one instance, and two Chromiums launched side
 *     by side from the same unpacked binary is exactly the case that hung.
 *   - Each render has a hard time limit. Past it, Chromium is killed and
 *     the render throws, so the document is marked failed (with the usual
 *     "generation failed" notice) instead of being left half-made.
 */
export const RENDER_TIMEOUT_MS = 60_000;
const CLOSE_TIMEOUT_MS = 5_000;

let renderQueue: Promise<unknown> = Promise.resolve();

/** Runs `task` after every render queued before it has settled. Exported
    for testing only. */
export function runOneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(task, task);
  renderQueue = run.catch(() => undefined);
  return run;
}

/** Re-exported for the renderer's own tests. */
export { withTimeout };

type LaunchedBrowser = Awaited<ReturnType<typeof puppeteer.launch>>;

function killBrowser(browser: LaunchedBrowser | null): void {
  try {
    browser?.process()?.kill('SIGKILL');
  } catch {
    // Already gone.
  }
}

async function closeBrowser(browser: LaunchedBrowser): Promise<void> {
  // close() itself can hang on a wedged Chromium; never let it hold the queue.
  await withTimeout(browser.close(), CLOSE_TIMEOUT_MS, () => killBrowser(browser)).catch(() => killBrowser(browser));
}

async function renderOnce(html: string): Promise<Buffer> {
  const state: { browser: LaunchedBrowser | null; timedOut: boolean } = { browser: null, timedOut: false };
  const work = (async () => {
    // Inside the time limit too: unpacking the serverless Chromium binary
    // is part of what can stall.
    const { executablePath, args } = await resolveLaunchOptions();
    const browser = await puppeteer.launch({ executablePath, args, headless: true });
    state.browser = browser;
    // A launch that finished after the time limit is closed straight away.
    if (state.timedOut) throw new Error('The PDF render was abandoned.');
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
  })();
  // If the limit passes first, the work is still settled (and its browser
  // closed) in the background, so nothing is left running or unhandled.
  const settled = work.finally(async () => {
    if (state.browser) await closeBrowser(state.browser);
  });
  settled.catch(() => undefined);
  return withTimeout(
    settled,
    RENDER_TIMEOUT_MS,
    () => {
      state.timedOut = true;
      killBrowser(state.browser);
    },
    `The PDF could not be made within ${Math.round(RENDER_TIMEOUT_MS / 1000)} seconds.`,
  );
}

export const puppeteerDocumentRenderer: DocumentRenderer = {
  renderHtmlToPdf(html: string): Promise<Buffer> {
    return runOneAtATime(() => renderOnce(html));
  },
};
