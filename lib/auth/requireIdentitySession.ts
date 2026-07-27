import { NextResponse } from 'next/server';
import type { Identity } from '../../types/identity';
import type { IdentitySession } from '../../types/identitySession';
import type { DataAdapterMode } from '../env';
import { getDataAdapterMode } from '../env';
import { getSession, clearSession } from './session';
import { resolveIdentitySession } from './resolveIdentitySession';

/**
 * Phase 21 (Identity, Authentication & Session Management). The gate for
 * every `/api/auth/*` Route Handler that requires an already-signed-in
 * identity (sessions list/revoke, change-password, switch-organization,
 * MFA management) — the identity-mode sibling of
 * lib/auth/requireAuthorizedOrganization.ts, but for routes that don't
 * (yet) need an organization-scoped authorization decision, only a
 * verified identity.
 *
 * Deliberately rejects `'mock'`/`'wix'` sessions outright (401) rather than
 * silently no-op'ing — these routes only make sense for the identity
 * system this phase built; a mock/wix session has no Membership/
 * IdentitySession rows to act on at all.
 */
export type IdentitySessionAccessResult =
  | { authorized: true; identity: Identity; identitySession: IdentitySession; dataAdapterMode: DataAdapterMode }
  | { authorized: false; response: NextResponse };

const UNAUTHENTICATED_RESPONSE = () => NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

export async function requireIdentitySession(): Promise<IdentitySessionAccessResult> {
  const session = await getSession();
  if (!session || session.user.source !== 'identity') {
    return { authorized: false, response: UNAUTHENTICATED_RESPONSE() };
  }

  const dataAdapterMode = getDataAdapterMode();
  const resolved = await resolveIdentitySession(session, dataAdapterMode);
  if (!resolved.valid) {
    await clearSession();
    return { authorized: false, response: UNAUTHENTICATED_RESPONSE() };
  }

  return {
    authorized: true,
    identity: resolved.identity,
    identitySession: resolved.identitySession,
    dataAdapterMode,
  };
}
