import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadCases } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import * as externalFormConfigService from '@/services/externalFormConfigService';
import * as caseFormLinkService from '@/services/caseFormLinkService';
import * as externalFormSubmissionService from '@/services/externalFormSubmissionService';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). Backs
 * Case Detail's "Forms" section — one row per `ExternalFormConfig` the
 * organization has, merged with this case's own `CaseFormLink` if one
 * already exists (a config with no link yet is reported as
 * `status: 'not_sent'` without requiring a row to exist purely for
 * display — a link row is only ever created the moment a link is
 * actually generated).
 *
 * Case repair UI (2026-09): also resolves the linked submission's
 * `pdfStatus`/`documentId` (read-only — this route never mutates
 * anything) so the UI can decide whether to offer "Retry Jotform PDF"
 * without a second round trip or requiring the caller to already know
 * the submission id.
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

  const rows = await Promise.all(
    configs.map(async (config) => {
      const link = links.find((l) => l.formConfigId === config.id) ?? null;
      const submission = link?.submissionId ? await externalFormSubmissionService.getById(link.submissionId, dataAdapterMode) : null;
      return {
        config,
        status: link?.status ?? 'not_sent',
        sentAt: link?.sentAt ?? null,
        submissionId: link?.submissionId ?? null,
        pdfStatus: submission?.pdfStatus ?? null,
        documentId: submission?.documentId ?? null,
      };
    }),
  );

  return NextResponse.json({ forms: rows });
}
