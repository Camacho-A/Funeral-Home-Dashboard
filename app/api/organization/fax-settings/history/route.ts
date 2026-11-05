import { NextResponse } from 'next/server';
import { authorizeFaxSettings, faxSettingsErrorResponse } from '@/lib/faxSettings/routeAuth';
import { listFaxConfigurationHistory } from '@/services/faxSettings/faxSettingsService';

/** Fax Settings (2026-11). GET ?organizationId=… → { history } — the fax_settings.* / fax_destination.* audit events. */
export async function GET(request: Request) {
  const auth = await authorizeFaxSettings(new URL(request.url).searchParams.get('organizationId'));
  if (!auth.context) return auth.response;
  try {
    return NextResponse.json({ history: await listFaxConfigurationHistory(auth.context.organizationId, auth.mode) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return faxSettingsErrorResponse(error, 'The fax configuration history could not be loaded.');
  }
}
