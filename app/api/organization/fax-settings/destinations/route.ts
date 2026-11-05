import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { authorizeFaxSettings, faxSettingsErrorResponse, readJsonObject } from '@/lib/faxSettings/routeAuth';
import { createFaxDestination } from '@/services/faxSettings/faxSettingsService';

/** Fax Settings (2026-11). POST { organizationId, destination: { name, faxNumber, purpose?, makeDefault? } } → { overview } */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  const auth = await authorizeFaxSettings(body.organizationId);
  if (!auth.context) return auth.response;
  try {
    return NextResponse.json({ overview: await createFaxDestination(auth.activity, body.destination, auth.mode) }, { status: 201 });
  } catch (error) {
    return faxSettingsErrorResponse(error, 'The destination could not be saved. Please try again.');
  }
}
