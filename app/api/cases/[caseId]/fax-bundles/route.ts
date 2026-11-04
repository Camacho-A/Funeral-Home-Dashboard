import { NextResponse } from 'next/server';
import { authorizeFax, faxErrorResponse } from '@/lib/faxBundles/routeAuth';
import { listCaseFaxHistory } from '@/services/faxBundles/faxBundleService';
import { loadCaseOnServer } from '@/services/serverCaseLoader';

/** Every fax bundle this case's DC application went out in. GET ?organizationId=… */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const auth = await authorizeFax(new URL(request.url).searchParams.get('organizationId'), 'read');
  if (!auth.context) return auth.response;
  try {
    const case_ = await loadCaseOnServer(auth.context.organizationId, caseId, auth.mode);
    if (!case_) return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
    return NextResponse.json({ history: await listCaseFaxHistory(auth.context.organizationId, caseId, auth.mode) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return faxErrorResponse(error, 'The fax history could not be loaded.');
  }
}
