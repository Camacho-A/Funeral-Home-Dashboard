import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadCases } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import * as externalFormConfigService from '@/services/externalFormConfigService';
import * as caseFormLinkService from '@/services/caseFormLinkService';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). Backs
 * Case Detail's "Forms" section — one row per `ExternalFormConfig` the
 * organization has, merged with this case's own `CaseFormLink` if one
 * already exists (a config with no link yet is reported as
 * `status: 'not_sent'` without requiring a row to exist purely for
 * display — a link row is only ever created the moment a link is
 * actually generated).
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: resolvedOrganizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadCases({ identityId: userId, organizationId: resolvedOrganizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view forms for this case.' }, { status: 403 });
  }

  const [configs, links] = await Promise.all([
    externalFormConfigService.listForOrganization(resolvedOrganizationId, dataAdapterMode),
    caseFormLinkService.listForCase(resolvedOrganizationId, caseId, dataAdapterMode),
  ]);

  const rows = configs.map((config) => {
    const link = links.find((l) => l.formConfigId === config.id) ?? null;
    return {
      config,
      status: link?.status ?? 'not_sent',
      sentAt: link?.sentAt ?? null,
      submissionId: link?.submissionId ?? null,
    };
  });

  return NextResponse.json({ forms: rows });
}
