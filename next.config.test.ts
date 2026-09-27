import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

/**
 * Item #1 (2026-09). `@sparticuz/chromium`/`puppeteer-core` must never be
 * webpack-bundled by Next.js — see next.config.ts's own comment for why
 * (the Chromium binary is loaded via a runtime-relative path inside the
 * package itself, which bundling breaks). This is the one assertion that
 * would have caught the missing configuration before it ever reached
 * Production.
 */
describe('next.config.ts — Vercel Chromium configuration (item #1)', () => {
  it('excludes @sparticuz/chromium and puppeteer-core from server bundling via serverExternalPackages', () => {
    expect(nextConfig.serverExternalPackages).toContain('@sparticuz/chromium');
    expect(nextConfig.serverExternalPackages).toContain('puppeteer-core');
  });

  /**
   * Item #1 follow-up (2026-09). serverExternalPackages alone left the
   * Chromium binary assets (node_modules/@sparticuz/chromium/bin/*.br)
   * out of the deployed function — they're loaded via a computed
   * fs path, not a require/import, so Next's static file tracer can't
   * discover them on its own. Proven in a real Production failure:
   * "The input directory .../node_modules/@sparticuz/chromium/bin does
   * not exist." This asserts the route-scoped outputFileTracingIncludes
   * fix stays in place, keyed by the App Router route's normalized path
   * (dynamic segment brackets preserved, no app/ prefix, no page/route
   * suffix — confirmed via direct .next build trace inspection).
   */
  it('includes @sparticuz/chromium/bin assets for the Statement route via outputFileTracingIncludes', () => {
    const includes = nextConfig.outputFileTracingIncludes;
    expect(includes).toBeDefined();
    const statementRouteGlobs = includes?.['/api/cases/[caseId]/billing/statement'];
    expect(statementRouteGlobs).toBeDefined();
    expect(statementRouteGlobs).toContain('./node_modules/@sparticuz/chromium/bin/**/*');
  });
});
