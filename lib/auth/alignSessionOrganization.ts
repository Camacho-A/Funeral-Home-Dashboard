import { getSession } from './session';
import { resolveAuthorizationContext } from './authorize';
import { resolveIdentitySession } from './resolveIdentitySession';
import { resolveMembershipAuthorizationContext } from './resolveMembershipAuthorizationContext';
import { setSessionOrganization } from '@/services/sessionService';
import { getDataAdapterMode, isValidOrganizationId } from '../env';

export type AlignSessionOrganizationResult =
  | { status: 'aligned' }
  | { status: 'switched' }
  | { status: 'denied' }
  | { status: 'mfa_enrollment_required' }
  | { status: 'unauthenticated' };

/**
 * Unified portal (Phase 5N, 2026-11). Organization-specific pages
 * (`/o/[organizationId]/...`) name their organization in the address. Before
 * anything renders, the server confirms — from the person's own active
 * membership, never from the address — that they may work in that
 * organization (deployment allowlist and per-organization MFA included,
 * exactly as POST /api/auth/switch-organization does), and makes it the
 * session's working organization, so every write on the page goes to that
 * one organization.
 *
 * `switched` means the caller must reload the page (the portal layout
 * already resolved the previous organization for this request).
 */
export async function alignSessionOrganization(organizationId: string): Promise<AlignSessionOrganizationResult> {
  if (!isValidOrganizationId(organizationId)) return { status: 'denied' };
  const session = await getSession();
  if (!session) return { status: 'unauthenticated' };
  const dataAdapterMode = getDataAdapterMode();

  if (session.user.source !== 'identity') {
    // Mock sign-in (mock data only) has no switchable session: only its own organization.
    const result = resolveAuthorizationContext(session, organizationId);
    return result.granted && result.context.organizationId === organizationId ? { status: 'aligned' } : { status: 'denied' };
  }

  const resolved = await resolveIdentitySession(session, dataAdapterMode);
  if (!resolved.valid) return { status: 'unauthenticated' };
  const result = await resolveMembershipAuthorizationContext(resolved.identitySession, dataAdapterMode, organizationId, undefined, { identity: resolved.identity });
  if (!result.granted) return { status: result.reason === 'mfa_enrollment_required' ? 'mfa_enrollment_required' : 'denied' };
  if (resolved.identitySession.organizationId === result.context.organizationId) return { status: 'aligned' };
  await setSessionOrganization(resolved.identitySession.id, result.context.organizationId, dataAdapterMode);
  return { status: 'switched' };
}
