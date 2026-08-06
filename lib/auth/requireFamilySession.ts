import { NextResponse } from 'next/server';
import type { PortalUser } from '../../types/portalUser';
import type { PortalSession } from '../../types/portalSession';
import type { DataAdapterMode } from '../env';
import { getDataAdapterMode } from '../env';
import { getFamilySession, clearFamilySession } from './familySession';
import { resolveFamilySession } from './resolveFamilySession';

/**
 * Phase 29 (Family Portal & External Collaboration). The gate for every
 * family-side building block that needs a verified, still-active
 * `PortalUser` — the `requireIdentitySession.ts` sibling for the family
 * side. Deliberately imports nothing from `requireIdentitySession.ts`,
 * `resolveIdentitySession.ts`, or `lib/auth/session.ts` — see
 * `lib/auth/sessionIsolation.test.ts` for the structural proof.
 *
 * This only proves "a real, active Family Portal user is signed in" — it
 * says nothing about *which case* they may access. Every family route
 * that touches case data calls `lib/auth/requireFamilyAccess.ts` instead,
 * which composes this resolution with a `PortalAccess` capability check.
 */
export type FamilySessionAccessResult =
  | { authorized: true; portalUser: PortalUser; portalSession: PortalSession; dataAdapterMode: DataAdapterMode }
  | { authorized: false; response: NextResponse };

const UNAUTHENTICATED_RESPONSE = () => NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

export async function requireFamilySession(): Promise<FamilySessionAccessResult> {
  const session = await getFamilySession();
  if (!session) {
    return { authorized: false, response: UNAUTHENTICATED_RESPONSE() };
  }

  const dataAdapterMode = getDataAdapterMode();
  const resolved = await resolveFamilySession(session, dataAdapterMode);
  if (!resolved.valid) {
    await clearFamilySession();
    return { authorized: false, response: UNAUTHENTICATED_RESPONSE() };
  }

  return {
    authorized: true,
    portalUser: resolved.portalUser,
    portalSession: resolved.portalSession,
    dataAdapterMode,
  };
}
