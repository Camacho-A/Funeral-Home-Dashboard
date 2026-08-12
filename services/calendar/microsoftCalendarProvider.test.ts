import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { microsoftCalendarProvider, isMicrosoftCalendarConfigured } from './microsoftCalendarProvider';
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
  process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
  process.env.MICROSOFT_CLIENT_SECRET = 'test-client-secret';
  process.env.MICROSOFT_REDIRECT_URI = 'https://beacon.test/api/calendar-connections/microsoft/callback';
});

afterEach(() => {
  delete process.env.MICROSOFT_CLIENT_ID;
  delete process.env.MICROSOFT_CLIENT_SECRET;
  delete process.env.MICROSOFT_REDIRECT_URI;
  vi.unstubAllGlobals();
});

describe('isMicrosoftCalendarConfigured', () => {
  it('is true only when all three env vars are set', () => {
    expect(isMicrosoftCalendarConfigured()).toBe(true);
    delete process.env.MICROSOFT_CLIENT_SECRET;
    expect(isMicrosoftCalendarConfigured()).toBe(false);
  });
});

describe('microsoftCalendarProvider.buildAuthorizeUrl', () => {
  it('uses the common (multi-tenant + personal) authority and includes state/PKCE', () => {
    const url = new URL(microsoftCalendarProvider.buildAuthorizeUrl('random-state', 'challenge-value'));
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(url.searchParams.get('state')).toBe('random-state');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('Calendars.ReadWrite');
    expect(url.searchParams.get('scope')).toContain('offline_access');
  });

  it('throws a clear error naming every missing env var', () => {
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_REDIRECT_URI;
    expect(() => microsoftCalendarProvider.buildAuthorizeUrl('s', 'c')).toThrow(/MICROSOFT_CLIENT_ID[\s\S]*MICROSOFT_REDIRECT_URI/);
  });
});

describe('microsoftCalendarProvider.exchangeCodeForTokens', () => {
  it('exchanges a code for tokens and resolves the account email via /me', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ mail: 'staff@example.com' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await microsoftCalendarProvider.exchangeCodeForTokens('auth-code', 'verifier');
    expect(result).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: expect.any(String), accountEmail: 'staff@example.com' });
  });

  it('falls back to userPrincipalName when mail is absent (personal Microsoft accounts)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ mail: null, userPrincipalName: 'staff@outlook.com' }) }),
    );
    const result = await microsoftCalendarProvider.exchangeCodeForTokens('auth-code', 'verifier');
    expect(result.accountEmail).toBe('staff@outlook.com');
  });

  it('throws when Microsoft does not return a refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'access-1', expires_in: 3600 }) }));
    await expect(microsoftCalendarProvider.exchangeCodeForTokens('code', 'verifier')).rejects.toThrow(/did not return a refresh token/);
  });

  it('maps a non-2xx token response to CalendarProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' }));
    await expect(microsoftCalendarProvider.exchangeCodeForTokens('bad-code', 'verifier')).rejects.toThrow(CalendarProviderError);
  });
});

describe('microsoftCalendarProvider.refreshAccessToken', () => {
  it('persists the rotated refresh token Microsoft always reissues', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }) }));
    const result = await microsoftCalendarProvider.refreshAccessToken('refresh-1');
    expect(result.refreshToken).toBe('refresh-2');
  });

  it('falls back to the original refresh token only defensively, if Microsoft omits one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'access-2', expires_in: 3600 }) }));
    const result = await microsoftCalendarProvider.refreshAccessToken('refresh-1');
    expect(result.refreshToken).toBe('refresh-1');
  });
});

describe('microsoftCalendarProvider.listCalendars', () => {
  it('maps Graph calendar items to {id, name}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ value: [{ id: 'cal-1', name: 'Calendar' }] }) }));
    const calendars = await microsoftCalendarProvider.listCalendars('access-1');
    expect(calendars).toEqual([{ id: 'cal-1', name: 'Calendar' }]);
  });
});

describe('microsoftCalendarProvider.createEvent / updateEvent / deleteEvent', () => {
  it('createEvent posts a Graph event body with local (non-UTC-suffixed) start/end times', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'graph-event-1' }) });
    vi.stubGlobal('fetch', fetchMock);

    const ref = await microsoftCalendarProvider.createEvent('access-1', 'cal-1', DRAFT);
    expect(ref).toEqual({ externalCalendarId: 'cal-1', externalEventId: 'graph-event-1' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.subject).toBe('Viewing');
    expect(sentBody.start.timeZone).toBe('America/New_York');
    // 14:00 UTC on 2026-09-10 is 10:00 local in America/New_York (EDT, UTC-4)
    // — no trailing 'Z', since Graph interprets dateTime as local wall time.
    expect(sentBody.start.dateTime).toBe('2026-09-10T10:00:00');
    expect(sentBody.start.dateTime).not.toContain('Z');
  });

  it('updateEvent PATCHes the specific event id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await microsoftCalendarProvider.updateEvent('access-1', { externalCalendarId: 'cal-1', externalEventId: 'graph-event-1' }, DRAFT);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/me/events/graph-event-1'), expect.objectContaining({ method: 'PATCH' }));
  });

  it('deleteEvent treats a 404 as success (already gone)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found' }));
    await expect(microsoftCalendarProvider.deleteEvent('access-1', { externalCalendarId: 'cal-1', externalEventId: 'gone' })).resolves.toBeUndefined();
  });

  it('deleteEvent throws CalendarProviderError for a genuine failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'Server error' }));
    await expect(microsoftCalendarProvider.deleteEvent('access-1', { externalCalendarId: 'cal-1', externalEventId: 'x' })).rejects.toThrow(CalendarProviderError);
  });
});
