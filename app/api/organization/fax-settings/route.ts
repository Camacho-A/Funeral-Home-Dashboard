import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { authorizeFaxSettings, faxSettingsErrorResponse, readJsonObject } from '@/lib/faxSettings/routeAuth';
import { getFaxSettingsOverview, updateFaxSettings } from '@/services/faxSettings/faxSettingsService';

/**
 * Fax Settings (2026-11) — administrators.
 *   GET   ?organizationId=…  → { overview }
 *   PATCH { organizationId, settings: { expectedRevision, providerKey?, subjectTemplate?, bodyEnabled?, bodyTemplate?, coverPageEnabled? } }
 * Fax sending cannot be turned on here (or anywhere but code).
 */
export async function GET(request: Request) {
  const auth = await authorizeFaxSettings(new URL(request.url).searchParams.get('organizationId'));
  if (!auth.context) return auth.response;
  try {
    return NextResponse.json({ overview: await getFaxSettingsOverview(auth.context.organizationId, auth.mode) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return faxSettingsErrorResponse(error, 'Fax Settings could not be loaded.');
  }
}

export async function PATCH(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  const auth = await authorizeFaxSettings(body.organizationId);
  if (!auth.context) return auth.response;
  try {
    return NextResponse.json({ overview: await updateFaxSettings(auth.activity, body.settings, auth.mode) });
  } catch (error) {
    return faxSettingsErrorResponse(error, 'Fax Settings could not be saved. Please try again.');
  }
}
