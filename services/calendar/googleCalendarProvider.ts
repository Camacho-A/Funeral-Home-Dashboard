import type { CalendarEventDraft, CalendarEventRef, CalendarListEntry, CalendarProvider, CalendarTokenExchangeResult, CalendarTokenRefreshResult } from './calendarProvider';
import { CalendarProviderError } from './calendarProvider';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Direct Google Calendar API/OAuth access via `fetch` — no
 * SDK, mirroring `lib/clover/cloverProvider.ts`'s established
 * "plain fetch, no SDK" precedent exactly.
 *
 * Scope: `calendar.events` — view/edit events on calendars the user has
 * access to, plus `calendar.readonly` for listing calendars to offer a
 * picker, plus `openid email` to resolve the connected account's own
 * display email. Deliberately not the broader `calendar` scope, which
 * also grants whole-calendar create/delete/management beyond what this
 * phase's one-way event sync needs.
 *
 * `access_type=offline&prompt=consent` on the authorize URL — required
 * to reliably receive a refresh token (Google only guarantees one on
 * first/forced consent, not on every re-authorization).
 *
 * Push notifications (`watch`) are deliberately not implemented here —
 * Phase 34's one-way (Beacon -> Google) sync baseline never needs to
 * learn about external changes, and `watch` channels require domain
 * verification plus manual 7-day renewal with no auto-renew mechanism,
 * a real operational cost this phase's scope doesn't need to take on.
 */

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly', 'openid', 'email'];

type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  const missing: string[] = [];
  if (!clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!redirectUri) missing.push('GOOGLE_REDIRECT_URI');
  if (missing.length > 0) {
    throw new Error(`Google Calendar integration requires the following environment variable(s), which are not set: ${missing.join(', ')}.`);
  }
  return { clientId: clientId!, clientSecret: clientSecret!, redirectUri: redirectUri! };
}

/** Whether a real Google connection should be attempted at all —
    mirrors `isResendConfigured()`/`isTwilioConfigured()`'s exact
    boolean-check role, used by routes/UI to decide whether to offer
    "Connect Google" at all. */
export function isGoogleCalendarConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

async function googleFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new CalendarProviderError(`Google Calendar API request failed (HTTP ${response.status}): ${body.slice(0, 500)}`, response.status);
  }
  return response;
}

function toGoogleEventBody(draft: CalendarEventDraft) {
  return {
    summary: draft.title,
    description: draft.description,
    location: draft.location ?? undefined,
    start: { dateTime: draft.startAt, timeZone: draft.timezone },
    end: { dateTime: draft.endAt, timeZone: draft.timezone },
  };
}

export const googleCalendarProvider: CalendarProvider = {
  buildAuthorizeUrl(state: string, codeChallenge: string): string {
    const { clientId, redirectUri } = getGoogleOAuthConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<CalendarTokenExchangeResult> {
    const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
    const response = await googleFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
      }).toString(),
    });
    const body = await response.json();
    const accessToken: string = body.access_token;
    const refreshToken: string = body.refresh_token;
    if (!refreshToken) {
      throw new CalendarProviderError('Google did not return a refresh token — access_type=offline/prompt=consent may not have been honored (e.g. already-consented account without prompt=consent).', 200);
    }
    const expiresAt = new Date(Date.now() + Number(body.expires_in) * 1000).toISOString();

    const userinfoResponse = await googleFetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    const userinfo = await userinfoResponse.json();

    return { accessToken, refreshToken, expiresAt, accountEmail: userinfo.email };
  },

  async refreshAccessToken(refreshToken: string): Promise<CalendarTokenRefreshResult> {
    const { clientId, clientSecret } = getGoogleOAuthConfig();
    const response = await googleFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });
    const body = await response.json();
    const expiresAt = new Date(Date.now() + Number(body.expires_in) * 1000).toISOString();
    // Google typically does NOT reissue a refresh token on a plain refresh
    // (the original stays valid) — fall back to the one passed in when the
    // response omits it, never discard a still-valid token.
    return { accessToken: body.access_token, refreshToken: body.refresh_token ?? refreshToken, expiresAt };
  },

  async listCalendars(accessToken: string): Promise<CalendarListEntry[]> {
    const response = await googleFetch(`${CALENDAR_API_BASE}/users/me/calendarList`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json();
    return (body.items ?? []).map((item: { id: string; summary: string }) => ({ id: item.id, name: item.summary }));
  },

  async createEvent(accessToken: string, calendarId: string, draft: CalendarEventDraft): Promise<CalendarEventRef> {
    const response = await googleFetch(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(toGoogleEventBody(draft)),
    });
    const body = await response.json();
    return { externalCalendarId: calendarId, externalEventId: body.id };
  },

  async updateEvent(accessToken: string, ref: CalendarEventRef, draft: CalendarEventDraft): Promise<void> {
    await googleFetch(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(ref.externalCalendarId)}/events/${encodeURIComponent(ref.externalEventId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(toGoogleEventBody(draft)),
    });
  },

  async deleteEvent(accessToken: string, ref: CalendarEventRef): Promise<void> {
    const response = await fetch(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(ref.externalCalendarId)}/events/${encodeURIComponent(ref.externalEventId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // A 404/410 here means the event is already gone (deleted directly in
    // Google, or never successfully created) — treated as success, not a
    // failure, since the caller's goal ("this event should not exist") is
    // already satisfied either way.
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const body = await response.text().catch(() => '');
      throw new CalendarProviderError(`Google Calendar API request failed (HTTP ${response.status}): ${body.slice(0, 500)}`, response.status);
    }
  },
};
