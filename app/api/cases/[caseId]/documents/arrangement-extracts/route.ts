import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canGenerateDocument, canReadCases } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { isArrangementExtractKind } from '@/domain/documents/arrangementPageExtracts';
import { ArrangementExtractError, extractArrangementPage, getArrangementExtractsState } from '@/services/arrangementPageExtractService';

export const maxDuration = 60;

/**
 * ME Form / Crematory Form (2026-10). Page 2 and page 3 of the case's
 * completed Arrangement Forms PDF, each saved as its own one-page case
 * document. Never sent anywhere; the Arrangement Form is only read.
 *
 *   GET  → { source, isMedicalExaminerCase, permit, latest }
 *   POST { organizationId, kind: 'me_form' | 'crematory_form', permitVerifiedByStaff? }
 *        → 201 saved | 200 unchanged | 422 refused (message says why) |
 *          428 the Crematory Form's permit needs staff confirmation
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadCases({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view this case.' }, { status: 403 });
  }

  try {
    const state = await getArrangementExtractsState(organizationId, caseId, dataAdapterMode);
    if (!state) return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
    return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ArrangementExtractError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Arrangement extracts state failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not load the Release Form and Crematory Form. Please try again.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { caseId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = (body ?? {}) as { organizationId?: unknown; kind?: unknown; permitVerifiedByStaff?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (!isArrangementExtractKind(b.kind)) return NextResponse.json({ error: "kind must be 'me_form' or 'crematory_form'." }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canGenerateDocument({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to add documents to this case.' }, { status: 403 });
  }

  try {
    const { outcome, document } = await extractArrangementPage(
      b.kind,
      caseId,
      { permitVerifiedByStaff: b.permitVerifiedByStaff === true },
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ outcome, documentId: document.id, version: document.version }, { status: outcome === 'saved' ? 201 : 200 });
  } catch (error) {
    if (error instanceof ArrangementExtractError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Arrangement page extraction failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The document could not be extracted. Nothing was changed. Please try again.' }, { status: 500 });
  }
}
