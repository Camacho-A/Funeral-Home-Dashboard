import { NextResponse } from 'next/server';

/**
 * Phase 21 (Identity, Authentication & Session Management). The same
 * generic "parse and validate a JSON request body" step every
 * `/api/auth/*` Route Handler needs — a deliberate near-duplicate of
 * lib/onboarding/routeHelpers.ts's own parseJsonBody rather than a shared
 * cross-import, keeping the auth and onboarding route layers independent
 * of each other (see this project's existing "one service owns one
 * collection"/module-isolation discipline elsewhere).
 */
export async function parseJsonBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) };
  }
  if (!body || typeof body !== 'object') {
    return { ok: false, response: NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }) };
  }
  return { ok: true, body: body as Record<string, unknown> };
}
