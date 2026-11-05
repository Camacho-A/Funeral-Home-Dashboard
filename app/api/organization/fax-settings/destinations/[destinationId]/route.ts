import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { authorizeFaxSettings, faxSettingsErrorResponse, readJsonObject } from '@/lib/faxSettings/routeAuth';
import { updateFaxDestination } from '@/services/faxSettings/faxSettingsService';

/** Fax Settings (2026-11). PATCH { organizationId, destination: { expectedRevision, name?, faxNumber?, purpose? } } → { overview } */
export async function PATCH(request: Request, { params }: { params: Promise<{ destinationId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { destinationId } = await params;
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  const auth = await authorizeFaxSettings(body.organizationId);
  if (!auth.context) return auth.response;
  try {
    return NextResponse.json({ overview: await updateFaxDestination(auth.activity, destinationId, body.destination, auth.mode) });
  } catch (error) {
    return faxSettingsErrorResponse(error, 'The destination could not be saved. Please try again.');
  }
}
