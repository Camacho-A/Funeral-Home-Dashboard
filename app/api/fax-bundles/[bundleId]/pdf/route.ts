import { NextResponse } from 'next/server';
import { authorizeFax, faxErrorResponse } from '@/lib/faxBundles/routeAuth';
import { getFaxBundlePdf } from '@/services/faxBundles/faxBundleService';

/**
 * The exact stored bundle PDF — the file Send Fax transmits — streamed from
 * private storage after an organization and permission check. Never cached,
 * never a public link. GET ?organizationId=…
 */
export async function GET(request: Request, { params }: { params: Promise<{ bundleId: string }> }) {
  const { bundleId } = await params;
  const auth = await authorizeFax(new URL(request.url).searchParams.get('organizationId'), 'send');
  if (!auth.context) return auth.response;
  try {
    const { bytes, fileName } = await getFaxBundlePdf(auth.context.organizationId, bundleId, auth.mode);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return faxErrorResponse(error, 'The bundle PDF could not be loaded.');
  }
}
