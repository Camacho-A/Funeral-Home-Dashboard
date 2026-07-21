import type { Metadata } from 'next';
import { Work_Sans } from 'next/font/google';
import '@/styles/globals.css';
import { Providers } from './providers';

// Self-hosted via next/font (Next.js-idiomatic — see docs/adr/ADR-001), rather
// than the prototype's literal Google Fonts <link>/@import. This is a
// deliberate, documented deviation: it avoids an external font request at
// runtime and matches App Router convention, while producing the same
// rendered typeface. The exposed CSS variable feeds --font-sans in
// styles/tokens.css.
const workSans = Work_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-work-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Beacon',
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
