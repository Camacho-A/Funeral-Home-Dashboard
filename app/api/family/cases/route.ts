import { NextResponse } from 'next/server';
import { requireFamilySession } from '@/lib/auth/requireFamilySession';
import { listFamilyCases } from '@/services/portal/portalCaseService';

/**
 * Phase 29 (Family Portal & External Collaboration). Every case this
 * session's Portal User currently has *active* access to — never
 * org-wide, never anything beyond what `listFamilyCases` itself already
 * scopes via `PortalAccess`.
 */
export async function GET() {
  const sessionResult = await requireFamilySession();
  if (!sessionResult.authorized) return sessionResult.response;

  const cases = await listFamilyCases(sessionResult.portalUser.id, sessionResult.dataAdapterMode);
  return NextResponse.json({ cases });
}
