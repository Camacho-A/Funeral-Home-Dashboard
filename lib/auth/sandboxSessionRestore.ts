import type { AuthSession } from '../../types/auth';
import type { Identity } from '../../types/identity';
import type { IdentitySession } from '../../types/identitySession';
import type { DataAdapterMode } from '../env';
import { getDeploymentOrganizationIds } from '../env';
import { isSandboxEnabled, isSandboxIsolated } from '../sandbox';
import { identitySessionFixtures } from '../../services/__mocks__/identityFixtures';

const RESTORED_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * SOLIS sandbox only (2026-10). The sandbox runs the real identity sign-in
 * over the fictional fixtures, whose session rows live in server memory. On
 * Vercel a fresh server instance starts with none, so a perfectly valid,
 * signed sign-in cookie would find no row and the tester would be signed
 * out mid-session.
 *
 * When — and only when — this is an isolated sandbox on mock data, the row
 * the signed cookie names is re-created for that same identity, so a
 * refresh keeps the same signed-in person. The cookie's signature and its
 * own hard expiry were already verified before this runs, and every other
 * check (identity active, membership, permissions) still applies after.
 * Real data never reaches here.
 */
export function restoreSandboxSession(session: AuthSession, identity: Identity | null, dataAdapterMode: DataAdapterMode): IdentitySession | null {
  if (dataAdapterMode !== 'mock' || !isSandboxEnabled() || !isSandboxIsolated()) return null;
  if (!session.sessionId || !identity || identity.id !== session.user.id || identity.status !== 'active') return null;

  const organizations = getDeploymentOrganizationIds();
  const now = new Date();
  const restored: IdentitySession = {
    id: session.sessionId,
    identityId: identity.id,
    organizationId: organizations?.length === 1 ? organizations[0] : null,
    deviceId: 'sandbox-restored',
    deviceName: null,
    ipAddress: null,
    userAgent: null,
    expiresAt: new Date(now.getTime() + RESTORED_SESSION_TTL_MS).toISOString(),
    lastSeenAt: now.toISOString(),
    passwordVersionAtIssue: identity.passwordVersion,
    revokedAt: null,
    createdAt: now.toISOString(),
  };
  identitySessionFixtures.push(restored);
  return restored;
}
