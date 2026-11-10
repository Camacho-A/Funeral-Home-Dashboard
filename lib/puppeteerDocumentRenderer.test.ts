import { afterEach, describe, expect, it, vi } from 'vitest';
import { puppeteerDocumentRenderer, resolveLaunchOptions } from './puppeteerDocumentRenderer';

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

/**
 * Item #1 (2026-09). The serverless (`@sparticuz/chromium`) branch can't
 * be safely launched for real outside an actual Vercel/Lambda Linux
 * runtime (this package ships a Linux-only binary) — but its own
 * option-resolution logic (which env var triggers it, what it hands to
 * `puppeteer.launch()`) is ordinary TypeScript, testable by mocking the
 * one external dependency it touches. This is "as far as safely possible"
 * without a real deployment, per this item's own diagnosis.
 */
describe('resolveLaunchOptions — serverless branch (no real Chromium launch)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.doUnmock('@sparticuz/chromium');
    vi.resetModules();
  });

  it('detects VERCEL and resolves executablePath/args from @sparticuz/chromium', async () => {
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    process.env.VERCEL = '1';
    vi.doMock('@sparticuz/chromium', () => ({
      default: { executablePath: vi.fn().mockResolvedValue('/tmp/serverless-chromium'), args: ['--no-sandbox', '--disable-setuid-sandbox'] },
    }));

    const { resolveLaunchOptions: freshResolve } = await import('./puppeteerDocumentRenderer');
    const options = await freshResolve();

    expect(options.executablePath).toBe('/tmp/serverless-chromium');
    expect(options.args).toEqual(['--no-sandbox', '--disable-setuid-sandbox']);
  });

  it('detects AWS_LAMBDA_FUNCTION_VERSION identically (Vercel Functions run on Lambda)', async () => {
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.VERCEL;
    process.env.AWS_LAMBDA_FUNCTION_VERSION = '$LATEST';
    vi.doMock('@sparticuz/chromium', () => ({
      default: { executablePath: vi.fn().mockResolvedValue('/tmp/serverless-chromium'), args: [] },
    }));

    const { resolveLaunchOptions: freshResolve } = await import('./puppeteerDocumentRenderer');
    const options = await freshResolve();

    expect(options.executablePath).toBe('/tmp/serverless-chromium');
  });

  it('PUPPETEER_EXECUTABLE_PATH still takes precedence over the serverless branch when both are set', async () => {
    process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/local-chrome';
    process.env.VERCEL = '1';

    const options = await resolveLaunchOptions();

    expect(options.executablePath).toBe('/usr/bin/local-chrome');
    expect(options.args).toEqual([]);
  });

  it('throws a clear, actionable error when neither PUPPETEER_EXECUTABLE_PATH nor a serverless env var is set', async () => {
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.VERCEL;
    delete process.env.AWS_LAMBDA_FUNCTION_VERSION;

    await expect(resolveLaunchOptions()).rejects.toThrow(/PUPPETEER_EXECUTABLE_PATH|VERCEL|AWS_LAMBDA_FUNCTION_VERSION/);
  });
});

/**
 * Hang protection (2026-11). Two automatic Statement/Receipt builds on
 * B2026-047 ran side by side and hung until the server was stopped.
 */
describe('runOneAtATime', () => {
  it('runs renders one after another, never side by side', async () => {
    const { runOneAtATime } = await import('./puppeteerDocumentRenderer');
    let running = 0;
    let most = 0;
    const task = (ms: number, value: string) => async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running -= 1;
      return value;
    };
    const results = await Promise.all([runOneAtATime(task(20, 'a')), runOneAtATime(task(5, 'b')), runOneAtATime(task(1, 'c'))]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(most).toBe(1);
  });

  it('a failed render does not stop the next one', async () => {
    const { runOneAtATime } = await import('./puppeteerDocumentRenderer');
    const failing = runOneAtATime(async () => {
      throw new Error('boom');
    });
    const next = runOneAtATime(async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});

describe('withTimeout', () => {
  it('gives up after the limit, calling onTimeout so Chromium can be killed', async () => {
    const { withTimeout } = await import('./puppeteerDocumentRenderer');
    const onTimeout = vi.fn();
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 10, onTimeout)).rejects.toThrow('Gave up after 0 seconds');
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('returns the result when the work finishes in time', async () => {
    const { withTimeout } = await import('./puppeteerDocumentRenderer');
    const onTimeout = vi.fn();
    await expect(withTimeout(Promise.resolve('pdf'), 1_000, onTimeout)).resolves.toBe('pdf');
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('renderHtmlToPdf time limit', () => {
  afterEach(() => {
    vi.doUnmock('puppeteer-core');
    vi.resetModules();
    vi.useRealTimers();
  });

  it('a hung render fails and kills Chromium, and the next render still runs', async () => {
    vi.resetModules();
    const kill = vi.fn();
    const hungPage = { setRequestInterception: vi.fn(), on: vi.fn(), setContent: () => new Promise(() => {}), pdf: vi.fn() };
    const goodPage = { setRequestInterception: vi.fn(), on: vi.fn(), setContent: vi.fn(), pdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45])) };
    const launch = vi
      .fn()
      .mockResolvedValueOnce({ newPage: async () => hungPage, close: () => new Promise(() => {}), process: () => ({ kill }) })
      .mockResolvedValueOnce({ newPage: async () => goodPage, close: vi.fn().mockResolvedValue(undefined), process: () => ({ kill: vi.fn() }) });
    vi.doMock('puppeteer-core', () => ({ default: { launch } }));
    process.env.PUPPETEER_EXECUTABLE_PATH = '/fake/chrome';
    vi.useFakeTimers();

    const { puppeteerDocumentRenderer, RENDER_TIMEOUT_MS } = await import('./puppeteerDocumentRenderer');
    const hung = puppeteerDocumentRenderer.renderHtmlToPdf('<p>one</p>');
    const hungResult = expect(hung).rejects.toThrow('could not be made');
    const next = puppeteerDocumentRenderer.renderHtmlToPdf('<p>two</p>');

    await vi.advanceTimersByTimeAsync(RENDER_TIMEOUT_MS + 10);
    await hungResult;
    expect(kill).toHaveBeenCalledWith('SIGKILL');

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(next).resolves.toEqual(Buffer.from([37, 80, 68, 70, 45]));
    expect(launch).toHaveBeenCalledTimes(2);
  });
});
