import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { portalUserFixtures, portalSessionFixtures } from '../../services/__mocks__/portalFixtures';
import { hashPassword } from '../../lib/identity/passwordHashing';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `resolve-family-session-test-${idCounter}`;
}

let lengths: { users: number; sessions: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { users: portalUserFixtures.length, sessions: portalSessionFixtures.length };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
});

async function seedPortalUserAndSession(email: string) {
  const { findOrCreatePortalUser } = await import('../../services/portal/portalUserService');
  const { createPortalSession } = await import('../../services/portal/portalSessionService');
  const { portalUser } = await findOrCreatePortalUser(
    { email, displayName: 'Resolve Test', passwordHash: hashPassword('Password123!'), idFactory },
    'mock',
  );
  const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
  return { portalUser, session };
}

function payload(portalUserId: string, sessionId: string) {
  return { portalUserId, sessionId, aud: 'family' as const, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
}

describe('resolveFamilySession', () => {
  it('returns valid:true for a fresh, unrevoked, unexpired session for an active portal user', async () => {
    const { resolveFamilySession } = await import('./resolveFamilySession');
    const { portalUser, session } = await seedPortalUserAndSession('valid.family@example.com');

    const result = await resolveFamilySession(payload(portalUser.id, session.id), 'mock');

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.portalUser.id).toBe(portalUser.id);
      expect(result.portalSession.id).toBe(session.id);
    }
  });

  it('slides the session expiration forward on a successful resolve', async () => {
    const { resolveFamilySession } = await import('./resolveFamilySession');
    const { portalUser, session } = await seedPortalUserAndSession('slides.family@example.com');
    const originalExpiry = session.expiresAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await resolveFamilySession(payload(portalUser.id, session.id), 'mock');

    const updated = portalSessionFixtures.find((s) => s.id === session.id)!;
    expect(new Date(updated.expiresAt).getTime()).toBeGreaterThanOrEqual(new Date(originalExpiry).getTime());
  });

  it('rejects a sessionId that does not exist in the registry', async () => {
    const { resolveFamilySession } = await import('./resolveFamilySession');
    const result = await resolveFamilySession(payload('portal-user-x', 'no-such-session'), 'mock');
    expect(result).toEqual({ valid: false, reason: 'session_not_found' });
  });

  it('rejects a revoked session', async () => {
    const { resolveFamilySession } = await import('./resolveFamilySession');
    const { revokeSession } = await import('../../services/portal/portalSessionService');
    const { portalUser, session } = await seedPortalUserAndSession('revoked.family@example.com');
    await revokeSession(session.id, 'mock');

    const result = await resolveFamilySession(payload(portalUser.id, session.id), 'mock');
    expect(result).toEqual({ valid: false, reason: 'revoked' });
  });

  it('rejects a session whose expiresAt has already passed', async () => {
    const { resolveFamilySession } = await import('./resolveFamilySession');
    const { portalUser, session } = await seedPortalUserAndSession('expired.family@example.com');
    const record = portalSessionFixtures.find((s) => s.id === session.id)!;
    record.expiresAt = new Date(Date.now() - 1000).toISOString();

    const result = await resolveFamilySession(payload(portalUser.id, session.id), 'mock');
    expect(result).toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects a session for a portal user that no longer exists', async () => {
    const { resolveFamilySession } = await import('./resolveFamilySession');
    const { createPortalSession } = await import('../../services/portal/portalSessionService');
    const orphanSession = await createPortalSession({ portalUserId: 'never-created', deviceId: 'device-1', idFactory }, 'mock');

    const result = await resolveFamilySession(payload('never-created', orphanSession.id), 'mock');
    expect(result).toEqual({ valid: false, reason: 'portal_user_not_found' });
  });

  it('rejects a session for a portal user that has been disabled', async () => {
    const { resolveFamilySession } = await import('./resolveFamilySession');
    const { updatePortalUser } = await import('../../services/portal/portalUserService');
    const { portalUser, session } = await seedPortalUserAndSession('disabled.family@example.com');
    await updatePortalUser(portalUser.id, { status: 'disabled' }, 'mock');

    const result = await resolveFamilySession(payload(portalUser.id, session.id), 'mock');
    expect(result).toEqual({ valid: false, reason: 'portal_user_disabled' });
  });
});
