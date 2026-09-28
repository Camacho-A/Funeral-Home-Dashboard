import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canViewDocument } from '@/services/authorizationPolicyService';
import { buildBulkPrintPdf, DocumentServiceError } from '@/services/documentService';
import { getDataAdapterMode, type DataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { caseFixtures } from '@/services/__mocks__/fixtures';

/**
 * Task #3 (2026-09) — "Print All." Same authorization/tenant-isolation
 * shape as bulk-download and the individual download route. Returns one
 * combined, printable PDF (pdf-lib page-copy/image-embed, never a
 * re-flattened original) for the client to open and print exactly the
 * way `utils/print.ts#printStoredDocument` already prints a single
 * document — fetch the bytes, open a Blob URL, call window.print(). No
 * new CaseDocument is created; the merged PDF exists only for this
 * response.
 */
async function resolveCaseNumber(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<string | null> {
  if (dataAdapterMode === 'mock') {
    return caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId)?.caseNumber ?? null;
  }
  const response = await queryWixDataItems<WixCaseItem>('cases', {
    filter: { beaconCaseId: caseId, organizationId, isArchived: false },
    paging: { limit: 1 },
  });
  return mapWixCaseItem(response.dataItems[0]?.data)?.caseNumber ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canViewDocument({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view documents for this case.' }, { status: 403 });
  }

  const caseNumber = await resolveCaseNumber(organizationId, caseId, dataAdapterMode);
  if (!caseNumber) {
    return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
  }

  try {
    const { pdfBuffer, fileName, excluded } = await buildBulkPrintPdf(
      organizationId,
      caseId,
      caseNumber,
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName.replace(/"/g, '')}"`,
        'X-Bulk-Excluded': encodeURIComponent(JSON.stringify(excluded)),
      },
    });
  } catch (error) {
    if (error instanceof DocumentServiceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
