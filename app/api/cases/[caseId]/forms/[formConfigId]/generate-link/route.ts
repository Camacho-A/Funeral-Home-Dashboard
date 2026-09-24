import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditCase } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import * as externalFormConfigService from '@/services/externalFormConfigService';
import * as caseFormLinkService from '@/services/caseFormLinkService';
import { buildJotformPrefillUrl } from '@/domain/externalForms/prefillUrl';
import { recordExternalFormLinkGenerated } from '@/services/activityService';
import type { Case } from '@/types/case';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). Gated by
 * `case.update` (generating/regenerating a form link is a case-adjacent
 * write action, same tier as any other case edit — never `case.create`,
 * since no case is ever created here). Returns the raw prefilled URL
 * exactly once — nothing about the raw token is ever persisted; only its
 * hash (see services/caseFormLinkService.ts).
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string; formConfigId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId, formConfigId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canEditCase({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to generate form links for this case.' }, { status: 403 });
  }

  const config = await externalFormConfigService.getById(organizationId, formConfigId, dataAdapterMode);
  if (!config) {
    return NextResponse.json({ error: 'Form configuration not found.' }, { status: 404 });
  }

  let theCase: Case | null;
  if (dataAdapterMode === 'mock') {
    theCase = caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId) ?? null;
  } else {
    const response = await queryWixDataItems<WixCaseItem>('cases', { filter: { _id: caseId, organizationId }, paging: { limit: 1 } });
    theCase = response.dataItems[0] ? mapWixCaseItem(response.dataItems[0].data) : null;
  }
  if (!theCase) {
    return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
  }

  const { link, rawToken } = await caseFormLinkService.generateLinkForSending(organizationId, caseId, config.provider, config.id, dataAdapterMode);

  const prefillUrl = buildJotformPrefillUrl(
    config,
    {
      caseNumber: theCase.caseNumber,
      decedentName: theCase.decedentName,
      dateOfBirth: theCase.dateOfBirth,
      dateOfDeath: theCase.dateOfDeath,
      nextOfKinName: theCase.nextOfKinName,
      nextOfKinPhone: theCase.nextOfKinPhone,
      nextOfKinEmail: theCase.nextOfKinEmail,
    },
    rawToken,
  );

  try {
    await recordExternalFormLinkGenerated(
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      caseId,
      link.id,
      config.label,
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record external_form.link_generated activity event:', error instanceof Error ? error.message : error);
  }

  return NextResponse.json({ link, prefillUrl });
}
