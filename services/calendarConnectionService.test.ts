import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listConnectionsForOrganization,
  listConnectionsForStaffProfile,
  getConnectionById,
  getActiveConnectionForStaffProfile,
  listActiveConnectionsForStaffProfile,
  beginAuthorization,
  completeAuthorization,
  disconnect,
  getValidAccessToken,
  CalendarConnectionServiceError,
} from './calendarConnectionService';
import { calendarConnectionFixtures } from './__mocks__/calendarFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { verifyOAuthStateCookie } from '../lib/auth/calendarOAuthState';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { CalendarConnection } from '../types/calendarConnection';

const TEST_CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'identity-manors-admin', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-disconnect-test' };

beforeEach(() => {
  calendarConnectionFixtures.length = 0;
  activityEventFixtures.length = 0;
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://beacon.test/api/calendar-connections/google/callback';
});

afterEach(() => {
  calendarConnectionFixtures.length = 0;
  activityEventFixtures.length = 0;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  vi.unstubAllGlobals();
});

function seedConnection(overrides: Partial<CalendarConnection> = {}): CalendarConnection {
  const connection: CalendarConnection = {
    id: `${DEFAULT_ORGANIZATION_ID}-staff-dana-google`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    staffProfileId: 'staff-dana',
    provider: 'google',
    externalAccountEmail: 'dana@gmail.com',
    externalCalendarId: 'primary',
    status: 'connected',
    scopesGranted: 'calendar.events',
    accessTokenCiphertext: 'ciphertext-access',
    refreshTokenCiphertext: 'ciphertext-refresh',
    tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    connectedAt: '2026-09-01T00:00:00.000Z',
    disconnectedAt: null,
    lastSyncAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
  calendarConnectionFixtures.push(connection);
  return connection;
}

describe('reads', () => {
  it('listConnectionsForOrganization / listConnectionsForStaffProfile / getConnectionById scope correctly', async () => {
    const connection = seedConnection();
    seedConnection({ id: 'other-org-staff-x-google', organizationId: 'other-org', staffProfileId: 'staff-x' });

    expect((await listConnectionsForOrganization(DEFAULT_ORGANIZATION_ID, 'mock')).map((c) => c.id)).toEqual([connection.id]);
    expect((await listConnectionsForStaffProfile(DEFAULT_ORGANIZATION_ID, 'staff-dana', 'mock')).map((c) => c.id)).toEqual([connection.id]);
    expect(await getConnectionById(DEFAULT_ORGANIZATION_ID, connection.id, 'mock')).toMatchObject({ id: connection.id });
    expect(await getConnectionById('other-org', connection.id, 'mock')).toBeNull(); // cross-tenant lookup fails
  });

  it('getActiveConnectionForStaffProfile only returns a "connected" row', async () => {
    seedConnection({ status: 'disconnected' });
    expect(await getActiveConnectionForStaffProfile(DEFAULT_ORGANIZATION_ID, 'staff-dana', 'google', 'mock')).toBeNull();
  });

  it('listActiveConnectionsForStaffProfile filters out non-connected rows', async () => {
    seedConnection({ status: 'connected' });
    seedConnection({ id: `${DEFAULT_ORGANIZATION_ID}-staff-dana-microsoft`, provider: 'microsoft', status: 'reauth_required' });
    const active = await listActiveConnectionsForStaffProfile(DEFAULT_ORGANIZATION_ID, 'staff-dana', 'mock');
    expect(active).toHaveLength(1);
    expect(active[0].provider).toBe('google');
  });
});

describe('beginAuthorization / completeAuthorization', () => {
  it('beginAuthorization builds a real provider authorize URL and a signed state cookie', async () => {
    const result = await beginAuthorization(DEFAULT_ORGANIZATION_ID, 'staff-dana', 'google', 'mock');
    expect(result.authorizeUrl).toContain('accounts.google.com');
    const verified = verifyOAuthStateCookie(result.stateCookieValue, new URL(result.authorizeUrl).searchParams.get('state')!);
    expect(verified).toMatchObject({ organizationId: DEFAULT_ORGANIZATION_ID, staffProfileId: 'staff-dana', provider: 'google' });
  });

  it('beginAuthorization rejects an inactive/nonexistent StaffProfile', async () => {
    await expect(beginAuthorization(DEFAULT_ORGANIZATION_ID, 'staff-does-not-exist', 'google', 'mock')).rejects.toThrow();
  });

  it('completeAuthorization exchanges the code, persists a connected connection, and reads context from the cookie (never request input)', async () => {
    const { stateCookieValue, authorizeUrl } = await beginAuthorization(DEFAULT_ORGANIZATION_ID, 'staff-dana', 'google', 'mock');
    const state = new URL(authorizeUrl).searchParams.get('state')!;

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }) }) // token exchange
        .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'dana@gmail.com' }) }) // userinfo
        .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 'primary', summary: 'dana@gmail.com' }] }) }), // listCalendars
    );

    const connection = await completeAuthorization('google', 'auth-code', stateCookieValue, state, 'mock');
    expect(connection.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    expect(connection.staffProfileId).toBe('staff-dana');
    expect(connection.status).toBe('connected');
    expect(connection.externalAccountEmail).toBe('dana@gmail.com');
    expect(connection.accessTokenCiphertext).not.toBe('access-1'); // encrypted, never plaintext
    expect(connection.accessTokenCiphertext).not.toContain('access-1');
    expect(activityEventFixtures.some((e) => e.eventType === 'scheduling.calendar.connected' && e.resourceId === connection.id)).toBe(true);
  });

  it('completeAuthorization rejects a state mismatch (the real CSRF check)', async () => {
    const { stateCookieValue } = await beginAuthorization(DEFAULT_ORGANIZATION_ID, 'staff-dana', 'google', 'mock');
    await expect(completeAuthorization('google', 'auth-code', stateCookieValue, 'wrong-state', 'mock')).rejects.toThrow(CalendarConnectionServiceError);
  });

  it('completeAuthorization rejects a provider mismatch between the cookie and the callback route', async () => {
    const { stateCookieValue, authorizeUrl } = await beginAuthorization(DEFAULT_ORGANIZATION_ID, 'staff-dana', 'google', 'mock');
    const state = new URL(authorizeUrl).searchParams.get('state')!;
    await expect(completeAuthorization('microsoft', 'auth-code', stateCookieValue, state, 'mock')).rejects.toThrow(CalendarConnectionServiceError);
  });

  it('completeAuthorization rejects linking an external account already connected to a different staff member', async () => {
    seedConnection({ staffProfileId: 'staff-chris', id: `${DEFAULT_ORGANIZATION_ID}-staff-chris-google`, externalAccountEmail: 'shared@gmail.com' });

    const { stateCookieValue, authorizeUrl } = await beginAuthorization(DEFAULT_ORGANIZATION_ID, 'staff-dana', 'google', 'mock');
    const state = new URL(authorizeUrl).searchParams.get('state')!;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'shared@gmail.com' }) }),
    );

    await expect(completeAuthorization('google', 'auth-code', stateCookieValue, state, 'mock')).rejects.toThrow(/already connected to a different staff member/);
  });
});

describe('disconnect', () => {
  it('marks the connection disconnected and clears the encrypted tokens, leaving everything else intact', async () => {
    const connection = seedConnection();
    const disconnected = await disconnect(DEFAULT_ORGANIZATION_ID, connection.id, TEST_CTX, 'mock');
    expect(disconnected.status).toBe('disconnected');
    expect(disconnected.disconnectedAt).not.toBeNull();
    expect(disconnected.accessTokenCiphertext).toBe('');
    expect(disconnected.refreshTokenCiphertext).toBe('');
    expect(disconnected.externalAccountEmail).toBe(connection.externalAccountEmail); // untouched
  });

  it('records a scheduling.calendar.disconnected activity event', async () => {
    const connection = seedConnection();
    await disconnect(DEFAULT_ORGANIZATION_ID, connection.id, TEST_CTX, 'mock');
    expect(activityEventFixtures.some((e) => e.eventType === 'scheduling.calendar.disconnected' && e.resourceId === connection.id)).toBe(true);
  });
});

describe('getValidAccessToken', () => {
  it('decrypts and returns the current token when still well within its expiry', async () => {
    const { encryptCalendarToken } = await import('../lib/identity/calendarTokenEncryption');
    const connection = seedConnection({ accessTokenCiphertext: encryptCalendarToken('real-access-token'), tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString() });
    const result = await getValidAccessToken(connection, 'mock');
    expect(result.accessToken).toBe('real-access-token');
  });

  it('proactively refreshes when within the buffer window of expiry, persisting the new ciphertext', async () => {
    const { encryptCalendarToken } = await import('../lib/identity/calendarTokenEncryption');
    const connection = seedConnection({
      accessTokenCiphertext: encryptCalendarToken('stale-access-token'),
      refreshTokenCiphertext: encryptCalendarToken('refresh-token-1'),
      tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(), // 1 minute out — inside the 10-minute buffer
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'fresh-access-token', expires_in: 3600 }) }));

    const result = await getValidAccessToken(connection, 'mock');
    expect(result.accessToken).toBe('fresh-access-token');
    expect(result.connection.status).toBe('connected');

    const persisted = calendarConnectionFixtures.find((c) => c.id === connection.id)!;
    const { decryptCalendarToken } = await import('../lib/identity/calendarTokenEncryption');
    expect(decryptCalendarToken(persisted.accessTokenCiphertext)).toBe('fresh-access-token');
  });

  it('flips the connection to reauth_required and rethrows when refresh itself fails', async () => {
    const { encryptCalendarToken } = await import('../lib/identity/calendarTokenEncryption');
    const connection = seedConnection({
      accessTokenCiphertext: encryptCalendarToken('stale-access-token'),
      refreshTokenCiphertext: encryptCalendarToken('revoked-refresh-token'),
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' }));

    await expect(getValidAccessToken(connection, 'mock')).rejects.toThrow();
    const persisted = calendarConnectionFixtures.find((c) => c.id === connection.id)!;
    expect(persisted.status).toBe('reauth_required');
    expect(persisted.lastErrorCode).toBe('token_refresh_failed');
  });
});
