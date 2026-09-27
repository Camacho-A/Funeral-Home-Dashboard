import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pins the workspace root to this project explicitly — without this, Next.js
  // walks up looking for lockfiles and can pick up an unrelated one in a parent
  // directory (e.g. a stray package-lock.json in the user's home directory).
  outputFileTracingRoot: path.join(__dirname),
  // Item #1 fix (2026-09): `puppeteer-core` and `@sparticuz/chromium` (the
  // headless-Chromium binary used to render Statement/document PDFs — see
  // lib/puppeteerDocumentRenderer.ts) must never be bundled by Next.js's
  // own webpack step. `@sparticuz/chromium` ships its actual Chromium
  // binary as compressed files (node_modules/@sparticuz/chromium/bin/*.br)
  // loaded via a runtime path relative to its own package, not a static
  // import Next can bundle — webpack-bundling it (the default for any
  // package Next doesn't know to treat specially) silently produces a
  // deployed function missing those binary assets, so `chromium.
  // executablePath()` resolves to a path that doesn't exist in Production.
  // `serverExternalPackages` is the current (Next.js 15, stable — not the
  // deprecated `experimental.serverComponentsExternalPackages`) top-level
  // config key for exactly this: it excludes a package from bundling and
  // lets Vercel's own output file tracing include it — and everything it
  // references — as-is from node_modules, which is the officially
  // documented fix for this exact `@sparticuz/chromium` + `puppeteer-core`
  // pairing on Vercel. No outputFileTracingIncludes glob is needed on top
  // of this — the package's own bin/ files are already reachable from its
  // own (now unbundled) source, which file tracing follows automatically.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
};

export default nextConfig;
