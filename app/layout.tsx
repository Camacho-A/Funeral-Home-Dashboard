import type { Metadata } from 'next';
import localFont from 'next/font/local';
import '@/styles/globals.css';
import { Providers } from './providers';

// Self-hosted via next/font (Next.js-idiomatic — see docs/adr/ADR-001), rather
// than the prototype's literal Google Fonts <link>/@import. This is a
// deliberate, documented deviation: it avoids an external font request at
// runtime and matches App Router convention, while producing the same
// rendered typeface. The exposed CSS variable feeds --font-sans in
// styles/tokens.css.
//
// Uses next/font/local against the @fontsource/work-sans package's static
// files, rather than next/font/google, because next/font/google fetches
// font CSS from Google's live API at build time — a build-time network
// dependency with a known, currently-open Next.js bug (vercel/next.js#99114)
// where Google Fonts occasionally returns an extensionless font-file URL
// that crashes the loader ("Cannot read properties of null (reading '1')").
// next/font/local has no such dependency: the font files are vendored in
// node_modules and never fetched over the network during a build.
const workSans = localFont({
  src: [
    { path: '../node_modules/@fontsource/work-sans/files/work-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../node_modules/@fontsource/work-sans/files/work-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../node_modules/@fontsource/work-sans/files/work-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../node_modules/@fontsource/work-sans/files/work-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
    { path: '../node_modules/@fontsource/work-sans/files/work-sans-latin-800-normal.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-work-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SOLIS',
  description: 'Operations platform for funeral homes and cremation providers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The skip-link targets #main-content; Phase 2's AppShell is responsible for
  // rendering a <main id="main-content"> landmark so this resolves correctly.
  return (
    <html lang="en" className={workSans.variable}>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
