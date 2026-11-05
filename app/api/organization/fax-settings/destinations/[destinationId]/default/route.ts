import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { authorizeFaxSettings, faxSettingsErrorResponse, readJsonObject } from '@/lib/faxSettings/routeAuth';
import { setDefaultFaxDestination } from '@/services/faxSettings/faxSettingsService';

/** Fax Settings (2026-11). POST { organizationId, expectedSettingsRevision } → { overview } */
export async function POST(request: Request, { params }: { params: Promise<{ destinationId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { destinationId } = await params;
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  const auth = await authorizeFaxSettings(body.organizationId);
  if (!auth.context) return auth.response;
  try {
    return NextResponse.json({ overview: await setDefaultFaxDestination(auth.activity, destinationId, body.expectedSettingsRevision, auth.mode) });
  } catch (error) {
    return faxSettingsErrorResponse(error, 'The default destination could not be changed. Please try again.');
  }
}
