import type { CalendarEventDraft, CalendarEventRef, CalendarListEntry, CalendarProvider, CalendarTokenExchangeResult, CalendarTokenRefreshResult } from './calendarProvider';
import { CalendarProviderError } from './calendarProvider';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Direct Microsoft Graph calendar API/OAuth access via
 * `fetch` — no SDK, mirroring `googleCalendarProvider.ts`'s identical
 * "plain fetch, no SDK" shape.
 *
 * Scope: `Calendars.ReadWrite offline_access openid profile email`
 * (delegated) — `offline_access` is required separately from
 * `Calendars.ReadWrite` to receive a refresh token at all.
 *
 * App registration must be "Accounts in any organizational directory
 * and personal Microsoft accounts" (the `common` authority) — Beacon
 * serves many independent funeral homes, each potentially its own
 * Microsoft 365 tenant or a personal Outlook.com account; a
 * single-tenant registration would only work for one customer.
 * Refresh tokens rotate on every use (Microsoft always issues a new
 * one) and expire after 90 days of inactivity — `refreshAccessToken`'s
 * result must always be persisted in full, never assuming the original
 * refresh token stays valid.
 *
 * **Tenant admin consent, a real limitation this adapter cannot route
 * around**: many Microsoft 365 business tenants require a tenant admin
 * to grant consent before any user can complete this OAuth flow for a
 * third-party app. When that happens, Microsoft's own authorize
 * redirect carries an error Beacon surfaces as-is — not a Beacon bug.
 *
 * Subscriptions/webhooks (push notifications) are deliberately not
 * implemented — max 3-day lifetime requiring active renewal, and
 * Phase 34's one-way sync baseline never needs to learn about external
 * changes at all.
 */

const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['Calendars.ReadWrite', 'offline_access', 'openid', 'profile', 'email'];

type MicrosoftOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

function getMicrosoftOAuthConfig(): MicrosoftOAuthConfig {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;

  const missing: string[] = [];
  if (!clientId) missing.push('MICROSOFT_CLIENT_ID');
  if (!clientSecret) missing.push('MICROSOFT_CLIENT_SECRET');
  if (!redirectUri) missing.push('MICROSOFT_REDIRECT_URI');
  if (missing.length > 0) {
    throw new Error(`Microsoft Calendar integration requires the following environment variable(s), which are not set: ${missing.join(', ')}.`);
  }
  return { clientId: clientId!, clientSecret: clientSecret!, redirectUri: redirectUri! };
}

/** Mirrors `isGoogleCalendarConfigured()`'s exact boolean-check role. */
export function isMicrosoftCalendarConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_REDIRECT_URI);
}

async function graphFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new CalendarProviderError(`Microsoft Graph API request failed (HTTP ${response.status}): ${body.slice(0, 500)}`, response.status);
  }
  return response;
}

/** Microsoft Graph's `dateTime` field is interpreted as local wall-clock
    time in the paired `timeZone` field — passing a 'Z'-suffixed UTC
    instant alongside a non-UTC timeZone would be silently
    misinterpreted. Converts the ISO UTC instant into an offset-free
    "YYYY-MM-DDTHH:mm:ss" local string via `Intl.DateTimeFormat`,
    `hourCycle: 'h23'` matching `domain/notifications/digestTiming.ts`'s
    own established convention for the exact same midnight-format
    pitfall. */
function toGraphLocalDateTime(isoUtc: string, timezone: string): string {
  const date = new Date(isoUtc);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

function toGraphEventBody(draft: CalendarEventDraft) {
  return {
    subject: draft.title,
    body: { contentType: 'text', content: draft.description },
    location: draft.location ? { displayName: draft.location } : undefined,
    start: { dateTime: toGraphLocalDateTime(draft.startAt, draft.timezone), timeZone: draft.timezone },
    end: { dateTime: toGraphLocalDateTime(draft.endAt, draft.timezone), timeZone: draft.timezone },
  };
}

export const microsoftCalendarProvider: CalendarProvider = {
  buildAuthorizeUrl(state: string, codeChallenge: string): string {
    const { clientId, redirectUri } = getMicrosoftOAuthConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      response_mode: 'query',
      scope: SCOPES.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<CalendarTokenExchangeResult> {
    const { clientId, clientSecret, redirectUri } = getMicrosoftOAuthConfig();
    const response = await graphFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        scope: SCOPES.join(' '),
      }).toString(),
    });
    const body = await response.json();
    const accessToken: string = body.access_token;
    const refreshToken: string = body.refresh_token;
    if (!refreshToken) {
      throw new CalendarProviderError('Microsoft did not return a refresh token — confirm offline_access was included in the requested scopes.', 200);
    }
    const expiresAt = new Date(Date.now() + Number(body.expires_in) * 1000).toISOString();

    const meResponse = await graphFetch(`${GRAPH_API_BASE}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const me = await meResponse.json();

    return { accessToken, refreshToken, expiresAt, accountEmail: me.mail ?? me.userPrincipalName };
  },

  async refreshAccessToken(refreshToken: string): Promise<CalendarTokenRefreshResult> {
    const { clientId, clientSecret } = getMicrosoftOAuthConfig();
    const response = await graphFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: SCOPES.join(' '),
      }).toString(),
    });
    const body = await response.json();
    const expiresAt = new Date(Date.now() + Number(body.expires_in) * 1000).toISOString();
    // Microsoft ALWAYS rotates the refresh token on use — body.refresh_token
    // is expected present; falling back to the old one is a defensive
    // last resort only, never the expected path.
    return { accessToken: body.access_token, refreshToken: body.refresh_token ?? refreshToken, expiresAt };
  },

  async listCalendars(accessToken: string): Promise<CalendarListEntry[]> {
    const response = await graphFetch(`${GRAPH_API_BASE}/me/calendars`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json();
    return (body.value ?? []).map((item: { id: string; name: string }) => ({ id: item.id, name: item.name }));
  },

  async createEvent(accessToken: string, calendarId: string, draft: CalendarEventDraft): Promise<CalendarEventRef> {
    const response = await graphFetch(`${GRAPH_API_BASE}/me/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(toGraphEventBody(draft)),
    });
    const body = await response.json();
    return { externalCalendarId: calendarId, externalEventId: body.id };
  },

  async updateEvent(accessToken: string, ref: CalendarEventRef, draft: CalendarEventDraft): Promise<void> {
    await graphFetch(`${GRAPH_API_BASE}/me/events/${encodeURIComponent(ref.externalEventId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(toGraphEventBody(draft)),
    });
  },

  async deleteEvent(accessToken: string, ref: CalendarEventRef): Promise<void> {
    const response = await fetch(`${GRAPH_API_BASE}/me/events/${encodeURIComponent(ref.externalEventId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // Same "already gone counts as success" reasoning as googleCalendarProvider.ts.
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const body = await response.text().catch(() => '');
      throw new CalendarProviderError(`Microsoft Graph API request failed (HTTP ${response.status}): ${body.slice(0, 500)}`, response.status);
    }
  },
};
