import { notFound } from 'next/navigation';
import { getSession } from './session';
import { resolveAuthorizationContext } from './authorize';
import { resolveIdentitySession } from './resolveIdentitySession';
import { resolveMembershipAuthorizationContext } from './resolveMembershipAuthorizationContext';
import { getDataAdapterMode } from '../env';
import { isModuleHiddenForOrganization } from './hiddenModuleGuard';
import type { HideableModuleKey } from '../../domain/organization/moduleVisibility';

/**
 * Server Component guard for a page that belongs to a hideable module
 * (Gus, 2026-10). Resolves the signed-in staff member's organization the
 * same way app/(portal)/layout.tsx does (which has already authenticated
 * the request) and answers `notFound()` when that organization hides the
 * module and enforces it server-side (lib/auth/hiddenModuleGuard.ts).
 * Any unresolvable session is left to the portal layout's own redirects.
 */
export async function guardHiddenModulePage(key: HideableModuleKey): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const dataAdapterMode = getDataAdapterMode();

  let organizationId: string | null = null;
  if (session.user.source === 'identity') {
    const resolved = await resolveIdentitySession(session, dataAdapterMode);
    if (!resolved.valid) return;
    const membership = await resolveMembershipAuthorizationContext(
      resolved.identitySession,
      dataAdapterMode,
    );
    if (membership.granted) organizationId = membership.context.organizationId;
  } else {
    const result = resolveAuthorizationContext(session);
    if (result.granted) organizationId = result.context.organizationId;
  }
  if (!organizationId) return;

  if (await isModuleHiddenForOrganization(organizationId, key, dataAdapterMode)) notFound();
}
