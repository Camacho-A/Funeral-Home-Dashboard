import { SignPageClient } from '@/components/signing/SignPageClient';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). The public
 * signing page — deliberately outside the `(portal)` route group (must
 * not inherit the authenticated-portal layout/shell). This shell only
 * resolves the `token` search param; all real interactivity (fetching
 * context, embedding the document, submitting sign/decline) lives in the
 * client component, since a signer needs live feedback on submission
 * rather than a full-page reload.
 */
export default async function SignPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>This signing link is missing its token.</p>
      </div>
    );
  }

  return <SignPageClient token={token} />;
}
