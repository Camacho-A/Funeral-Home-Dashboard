import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * Router cache staleness (2026-10) — fixes cases and dashboards that sat
   * on "Loading…" indefinitely.
   *
   * Measured against production: the server renders a full case page,
   * sidebar and all, in ~660ms. The page still hung, because the App
   * Router was rendering from its own client-side cache rather than from
   * the server. With a `loading.tsx` boundary present, a PREFETCH of a
   * dynamic route deliberately returns only the loading shell — measured
   * at 2,508 bytes containing nothing but "Loading…", against 22,636
   * bytes for the real document. Next's default `dynamic` staleTime then
   * let the router keep reusing that shell entry, so navigating to a case
   * rendered the skeleton and never went back for the content.
   *
   * `dynamic: 0` makes the router treat dynamic segments as immediately
   * stale, so every navigation fetches the real thing instead of
   * re-rendering a cached shell. The server is fast enough that this
   * costs well under a second; being stuck cost staff 40+ seconds and
   * usually never resolved.
   *
   * This changes CLIENT-side caching only. Nothing about authentication,
   * authorization, tenant isolation, or server rendering changes: every
   * request still re-resolves session, membership and permissions
   * server-side exactly as before.
   */
  experimental: {
    staleTimes: { dynamic: 0, static: 0 },
  },
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
  // config key for exactly this: it excludes the package from bundling, so
  // its own build/*.js files resolve and trace correctly as ordinary
  // node_modules requires (confirmed directly in a real `next build`'s
  // generated .next/server/.../route.js.nft.json — every @sparticuz/chromium
  // *.js file is traced correctly).
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  // Item #1 follow-up fix (2026-09) — proven necessary by an actual
  // Production failure after the serverExternalPackages-only fix above:
  // "The input directory .../node_modules/@sparticuz/chromium/bin does
  // not exist." serverExternalPackages only keeps the package's *JS
  // module graph* un-bundled/traceable — it does nothing for the
  // `bin/*.br` Chromium binary assets, which chromium.executablePath()
  // locates via a computed `fs.existsSync`/`path.join(__dirname, '..',
  // 'bin', ...)` call, not a `require`/`import` statement. Next's file
  // tracer (@vercel/nft) only discovers files reachable through the
  // static module graph, so it has no way to know this directory is
  // needed — confirmed directly: a real build's trace for this route
  // included every @sparticuz/chromium *.js file but none of bin/'s 4
  // files. outputFileTracingIncludes is Next's own documented mechanism
  // for exactly this class of gap ("manually including traced files if
  // some were not detected on a per-page basis"). Scoped to only this
  // one route — no other route launches Chromium — and to only the bin/
  // directory specifically (not the whole package, which the JS tracing
  // above already covers correctly on its own).
  outputFileTracingIncludes: {
    '/api/cases/[caseId]/billing/statement': ['./node_modules/@sparticuz/chromium/bin/**/*'],
  },
};

export default nextConfig;
