import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { googleCalendarProvider, isGoogleCalendarConfigured } from './googleCalendarProvider';
import { CalendarProviderError } from './calendarProvider';
import type { CalendarEventDraft } from './calendarProvider';

const DRAFT: CalendarEventDraft = {
  title: 'Viewing',
  description: 'Family viewing for Robert Ellison',
  startAt: '2026-09-10T14:00:00.000Z',
  endAt: '2026-09-10T15:00:00.000Z',
  location: '123 Main St',
  timezone: 'America/New_York',
};

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://beacon.test/api/calendar-connections/google/callback';
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  vi.unstubAllGlobals();
});

describe('isGoogleCalendarConfigured', () => {
  it('is true only when all three env vars are set', () => {
    expect(isGoogleCalendarConfigured()).toBe(true);
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isGoogleCalendarConfigured()).toBe(false);
  });
});

describe('googleCalendarProvider.buildAuthorizeUrl', () => {
  it('includes state, PKCE challenge, offline access, and forced consent', () => {
    const url = new URL(googleCalendarProvider.buildAuthorizeUrl('random-state', 'challenge-value'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('state')).toBe('random-state');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toContain('calendar.events');
  });

  it('throws a clear error naming every missing env var', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_REDIRECT_URI;
    expect(() => googleCalendarProvider.buildAuthorizeUrl('s', 'c')).toThrow(/GOOGLE_CLIENT_ID[\s\S]*GOOGLE_REDIRECT_URI/);
  });
});

describe('googleCalendarProvider.exchangeCodeForTokens', () => {
  it('exchanges a code for tokens and resolves the account email via userinfo', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'staff@example.com' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await googleCalendarProvider.exchangeCodeForTokens('auth-code', 'verifier');
    expect(result).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: expect.any(String), accountEmail: 'staff@example.com' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tokenCallBody = fetchMock.mock.calls[0][1].body as string;
    expect(tokenCallBody).toContain('code_verifier=verifier');
    expect(tokenCallBody).toContain('grant_type=authorization_code');
  });

  it('throws when Google does not return a refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'access-1', expires_in: 3600 }) }));
    await expect(googleCalendarProvider.exchangeCodeForTokens('code', 'verifier')).rejects.toThrow(/did not return a refresh token/);
  });

  it('maps a non-2xx token response to CalendarProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' }));
    await expect(googleCalendarProvider.exchangeCodeForTokens('bad-code', 'verifier')).rejects.toThrow(CalendarProviderError);
  });
});

describe('googleCalendarProvider.refreshAccessToken', () => {
  it('returns a new access token, falling back to the original refresh token when none is reissued', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'access-2', expires_in: 3600 }) }));
    const result = await googleCalendarProvider.refreshAccessToken('refresh-1');
    expect(result.accessToken).toBe('access-2');
    expect(result.refreshToken).toBe('refresh-1');
  });

  it('uses a reissued refresh token when Google does provide one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }) }));
    const result = await googleCalendarProvider.refreshAccessToken('refresh-1');
    expect(result.refreshToken).toBe('refresh-2');
  });
});

describe('googleCalendarProvider.listCalendars', () => {
  it('maps calendarList items to {id, name}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: 'primary', summary: 'jane@gmail.com' }] }) }));
    const calendars = await googleCalendarProvider.listCalendars('access-1');
    expect(calendars).toEqual([{ id: 'primary', name: 'jane@gmail.com' }]);
  });
});

describe('googleCalendarProvider.createEvent / updateEvent / deleteEvent', () => {
  it('createEvent posts the mapped event body and returns a CalendarEventRef', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'google-event-1' }) });
    vi.stubGlobal('fetch', fetchMock);

    const ref = await googleCalendarProvider.createEvent('access-1', 'primary', DRAFT);
    expect(ref).toEqual({ externalCalendarId: 'primary', externalEventId: 'google-event-1' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.summary).toBe('Viewing');
    expect(sentBody.start).toEqual({ dateTime: DRAFT.startAt, timeZone: DRAFT.timezone });
  });

  it('updateEvent PUTs to the specific event id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await googleCalendarProvider.updateEvent('access-1', { externalCalendarId: 'primary', externalEventId: 'google-event-1' }, DRAFT);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/events/google-event-1'), expect.objectContaining({ method: 'PUT' }));
  });

  it('deleteEvent treats a 404 as success (already gone)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found' }));
    await expect(googleCalendarProvider.deleteEvent('access-1', { externalCalendarId: 'primary', externalEventId: 'gone' })).resolves.toBeUndefined();
  });

  it('deleteEvent throws CalendarProviderError for a genuine failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'Server error' }));
    await expect(googleCalendarProvider.deleteEvent('access-1', { externalCalendarId: 'primary', externalEventId: 'x' })).rejects.toThrow(CalendarProviderError);
  });
});
