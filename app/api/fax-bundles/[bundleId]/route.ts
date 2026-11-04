import { NextResponse } from 'next/server';
import { authorizeFax, faxErrorResponse } from '@/lib/faxBundles/routeAuth';
import { getFaxBundleView } from '@/services/faxBundles/faxBundleService';

/** A fax bundle's status and contents. GET ?organizationId=… */
export async function GET(request: Request, { params }: { params: Promise<{ bundleId: string }> }) {
  const { bundleId } = await params;
  const auth = await authorizeFax(new URL(request.url).searchParams.get('organizationId'), 'read');
  if (!auth.context) return auth.response;
  try {
    return NextResponse.json({ bundle: await getFaxBundleView(auth.context.organizationId, bundleId, auth.mode) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return faxErrorResponse(error, 'The fax bundle could not be loaded.');
  }
}
