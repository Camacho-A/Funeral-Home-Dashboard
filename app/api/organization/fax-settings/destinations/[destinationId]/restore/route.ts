import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { authorizeFaxSettings, faxSettingsErrorResponse, readJsonObject } from '@/lib/faxSettings/routeAuth';
import { restoreFaxDestination } from '@/services/faxSettings/faxSettingsService';

/** Fax Settings (2026-11). POST { organizationId, expectedRevision } → { overview }. Back to the active list; not made the default. */
export async function POST(request: Request, { params }: { params: Promise<{ destinationId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { destinationId } = await params;
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  const auth = await authorizeFaxSettings(body.organizationId);
  if (!auth.context) return auth.response;
  try {
    return NextResponse.json({ overview: await restoreFaxDestination(auth.activity, destinationId, body.expectedRevision, auth.mode) });
  } catch (error) {
    return faxSettingsErrorResponse(error, 'The destination could not be restored. Please try again.');
  }
}
