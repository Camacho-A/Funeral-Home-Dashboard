import { NextResponse } from 'next/server';
import { authorizeCrematory, crematoryErrorResponse } from '@/lib/crematory/routeAuth';
import { getCrematoryCaseSummary, getOrganizationCrematorySettings, listCrematoryCandidates } from '@/services/crematory/crematoryPackageService';
import { getCrematoryMailboxStatus } from '@/services/crematory/crematoryMailboxService';
import { sendToCrematoryConfig } from '@/domain/crematory/crematorySettings';

export const maxDuration = 60;

/**
 * Send to Crematory (2026-10) — the Cases page batch. Every open cremation
 * case with what it still needs, the organization's default recipients,
 * and which mailbox would send (never its tokens).
 */
export async function GET(request: Request) {
  const auth = await authorizeCrematory(new URL(request.url).searchParams.get('organizationId'), 'read');
  if (!auth.context) return auth.response;
  try {
    const organizationId = auth.context.organizationId;
    // ?caseId= — just that case (the case page's own Send to Crematory).
    const caseId = new URL(request.url).searchParams.get('caseId');
    const [candidates, settings, mailbox] = await Promise.all([
      caseId ? getCrematoryCaseSummary(organizationId, caseId, auth.canSend, auth.mode).then((summary) => [summary]) : listCrematoryCandidates(organizationId, auth.canSend, auth.mode),
      getOrganizationCrematorySettings(organizationId, auth.mode),
      getCrematoryMailboxStatus(organizationId, auth.mode),
    ]);
    return NextResponse.json(
      { candidates, settings, mailbox, organizationName: sendToCrematoryConfig(organizationId)!.emailOrganizationName, canSend: auth.canSend, canPrepare: auth.canPrepare },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return crematoryErrorResponse(error, 'Could not load cases for the crematory. Please try again.');
  }
}
