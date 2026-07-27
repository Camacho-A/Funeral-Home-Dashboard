import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { identityFixtures, identitySessionFixtures } from '../../services/__mocks__/identityFixtures';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `resolve-session-test-${idCounter}`;
}

let lengths: { identity: number; sessions: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { identity: identityFixtures.length, sessions: identitySessionFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  identitySessionFixtures.length = lengths.sessions;
});

async function seedIdentityAndSession(email: string, overrides: { passwordVersionAtIssue?: number } = {}) {
  const { findOrCreateIdentity, updateIdentity } = await import('../../services/identityService');
  const { createIdentitySession } = await import('../../services/sessionService');
  const { identity } = await findOrCreateIdentity({ email, displayName: 'Resolve Test', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  const session = await createIdentitySession(
    {
      identityId: identity.id,
      deviceId: 'device-1',
      rememberDevice: false,
      passwordVersionAtIssue: overrides.passwordVersionAtIssue ?? identity.passwordVersion,
      idFactory,
    },
    'mock',
  );
  return { identity, session };
}

describe('resolveIdentitySession', () => {
  it('returns valid:true for a fresh, unrevoked, unexpired session issued under the current password version', async () => {
    const { resolveIdentitySession } = await import('./resolveIdentitySession');
    const { identity, session } = await seedIdentityAndSession('valid.session@example.com');

    const result = await resolveIdentitySession({ user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sessionId: session.id }, 'mock');

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.identity.id).toBe(identity.id);
      expect(result.identitySession.id).toBe(session.id);
    }
  });

  it('slides the session expiration forward on a successful resolve', async () => {
    const { resolveIdentitySession } = await import('./resolveIdentitySession');
    const { identity, session } = await seedIdentityAndSession('slides.forward@example.com');
    const originalExpiry = session.expiresAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await resolveIdentitySession({ user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sessionId: session.id }, 'mock');

    const updated = identitySessionFixtures.find((s) => s.id === session.id)!;
    expect(new Date(updated.expiresAt).getTime()).toBeGreaterThanOrEqual(new Date(originalExpiry).getTime());
  });

  it('rejects a session with no sessionId at all', async () => {
    const { resolveIdentitySession } = await import('./resolveIdentitySession');
    const result = await resolveIdentitySession({ user: { id: 'x', email: 'x@example.com', displayName: 'X', source: 'identity' }, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER }, 'mock');
    expect(result).toEqual({ valid: false, reason: 'missing_session_id' });
  });

  it('rejects a sessionId that does not exist in the registry', async () => {
    const { resolveIdentitySession } = await import('./resolveIdentitySession');
    const result = await resolveIdentitySession({ user: { id: 'x', email: 'x@example.com', displayName: 'X', source: 'identity' }, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sessionId: 'no-such-session' }, 'mock');
    expect(result).toEqual({ valid: false, reason: 'session_not_found' });
  });

  it('rejects a revoked session', async () => {
    const { resolveIdentitySession } = await import('./resolveIdentitySession');
    const { revokeSession } = await import('../../services/sessionService');
    const { identity, session } = await seedIdentityAndSession('revoked.session@example.com');
    await revokeSession(session.id, 'mock');

    const result = await resolveIdentitySession({ user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sessionId: session.id }, 'mock');
    expect(result).toEqual({ valid: false, reason: 'revoked' });
  });

  it('rejects a session whose expiresAt has already passed', async () => {
    const { resolveIdentitySession } = await import('./resolveIdentitySession');
    const { identity, session } = await seedIdentityAndSession('expired.session@example.com');
    const record = identitySessionFixtures.find((s) => s.id === session.id)!;
    record.expiresAt = new Date(Date.now() - 1000).toISOString();

    const result = await resolveIdentitySession({ user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sessionId: session.id }, 'mock');
    expect(result).toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects a session issued under a password version that no longer matches the identity\'s current one', async () => {
    const { resolveIdentitySession } = await import('./resolveIdentitySession');
    const { identity, session } = await seedIdentityAndSession('stale.password.version@example.com', { passwordVersionAtIssue: 0 });
    const { setPassword } = await import('../../services/passwordService');
    await setPassword(identity.id, 'BrandNewPassword1!', 'mock'); // bumps passwordVersion past what the session was issued with

    const result = await resolveIdentitySession({ user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sessionId: session.id }, 'mock');
    expect(result).toEqual({ valid: false, reason: 'password_changed' });
  });

  it('rejects a session for an identity that is no longer active (e.g. locked)', async () => {
    const { resolveIdentitySession } = await import('./resolveIdentitySession');
    const { updateIdentity } = await import('../../services/identityService');
    const { identity, session } = await seedIdentityAndSession('now.locked@example.com');
    await updateIdentity(identity.id, { status: 'locked' }, 'mock');

    const result = await resolveIdentitySession({ user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, sessionId: session.id }, 'mock');
    expect(result).toEqual({ valid: false, reason: 'identity_not_active' });
  });
});
