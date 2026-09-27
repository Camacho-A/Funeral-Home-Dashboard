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
});
