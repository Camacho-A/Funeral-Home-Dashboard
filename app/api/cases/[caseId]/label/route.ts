import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization, type RouteAuthorizationResult } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canGenerateDocument, canReadCases } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import { CremationLabelError, getCremationLabelState, saveCremationLabel } from '@/services/cremationLabelService';

/**
 * Cremation Label (2026-10). The case's DYMO label: Manors' approved
 * template filled with the decedent's name, Tag # and Date of Cremation,
 * saved to the case's documents so it can be printed later from any
 * computer. Neither action needs a printer or DYMO Connect.
 *
 *   GET  → { current, latest, latestMatchesCase }   read-only
 *   POST { organizationId, expectedLatestDocumentId } → saves the next
 *        version (201), or { outcome: 'unchanged' } (200) when the latest
 *        saved label already says exactly this.
 */
async function authorize(requestedOrganizationId: string | null): Promise<{ context: AuthorizedContext; response?: never } | { context?: never; response: Response }> {
  if (!requestedOrganizationId) return { response: NextResponse.json({ error: 'organizationId is required.' }, { status: 400 }) };
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return { response: authResult.response };
  if (!getRegisteredOrganizationProfile(authResult.context.organizationId).features.dymoCaseLabel) {
    return { response: NextResponse.json({ error: 'Labels are not set up for this organization.' }, { status: 404 }) };
  }
  return { context: authResult.context };
}

type AuthorizedContext = Extract<RouteAuthorizationResult, { authorized: true }>['context'];

const policy = (context: AuthorizedContext) => ({ identityId: context.userId, organizationId: context.organizationId, roleKey: context.role });

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const auth = await authorize(new URL(request.url).searchParams.get('organizationId'));
  if (!auth.context) return auth.response;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadCases(policy(auth.context), dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view this case.' }, { status: 403 });
  }

  try {
    const state = await getCremationLabelState(auth.context.organizationId, caseId, dataAdapterMode);
    if (!state) return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
    return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Cremation label state failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The label could not be loaded. Please try again.' }, { status: 500 });
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
  const b = (body ?? {}) as { organizationId?: unknown; expectedLatestDocumentId?: unknown };
  if (b.expectedLatestDocumentId !== null && typeof b.expectedLatestDocumentId !== 'string') {
    return NextResponse.json({ error: 'expectedLatestDocumentId must be the latest saved label id, or null.' }, { status: 400 });
  }

  const auth = await authorize(typeof b.organizationId === 'string' ? b.organizationId : null);
  if (!auth.context) return auth.response;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canGenerateDocument(policy(auth.context), dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to save documents for this case.' }, { status: 403 });
  }

  try {
    const { outcome, document } = await saveCremationLabel(
      { organizationId: auth.context.organizationId, actorIdentityId: auth.context.userId, actorMembershipId: null, actorRoleKey: auth.context.role, correlationId: crypto.randomUUID() },
      caseId,
      b.expectedLatestDocumentId,
      dataAdapterMode,
    );
    return NextResponse.json({ outcome, documentId: document.id, version: document.version }, { status: outcome === 'saved' ? 201 : 200 });
  } catch (error) {
    if (error instanceof CremationLabelError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Cremation label save failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The label could not be saved. Nothing was changed. Please try again.' }, { status: 500 });
  }
}
