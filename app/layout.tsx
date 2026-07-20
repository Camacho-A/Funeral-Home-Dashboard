import type { Metadata } from 'next';
import '@/styles/globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Beacon',
  description: 'Operations platform for funeral homes and cremation providers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The skip-link targets #main-content; Phase 2's AppShell is responsible for
  // rendering a <main id="main-content"> landmark so this resolves correctly.
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
