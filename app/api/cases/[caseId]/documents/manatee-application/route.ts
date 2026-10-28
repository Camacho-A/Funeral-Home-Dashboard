import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canGenerateDocument, canReadCases } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import {
  ManateeApplicationError,
  getManateeApplicationDraft,
  previewManateeApplication,
  saveManateeApplication,
  type ManateeApplicationInput,
} from '@/services/manateeApplicationService';

export const maxDuration = 60;

/**
 * Manatee County — Death Certificate Application (2026-10).
 *
 *   GET  ?organizationId=…  → the draft to review (never the SSN itself —
 *        only whether one is on file and its last four digits)
 *   POST { organizationId, action: 'preview', values } → the filled PDF, not stored
 *   POST { organizationId, action: 'save', values }    → 201 { document }
 *
 * Responses are never cached. Error messages never carry submitted values.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const mode = getDataAdapterMode();
  const policy = { identityId: userId, organizationId, roleKey: role };
  const [canRead, canGenerate] = await Promise.all([canReadCases(policy, mode), canGenerateDocument(policy, mode)]);
  if (!canRead || !canGenerate) return NextResponse.json({ error: 'Not authorized to create documents for this case.' }, { status: 403 });

  try {
    const draft = await getManateeApplicationDraft(
      organizationId,
      caseId,
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      mode,
    );
    return NextResponse.json(draft, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error, 'Could not load the Manatee County application. Please try again.');
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
  const b = (body ?? {}) as { organizationId?: unknown; action?: unknown; values?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (b.action !== 'preview' && b.action !== 'save') return NextResponse.json({ error: "action must be 'preview' or 'save'." }, { status: 400 });
  const values = parseInput(b.values);
  if (!values) return NextResponse.json({ error: 'The application values are malformed.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const mode = getDataAdapterMode();
  const policy = { identityId: userId, organizationId, roleKey: role };
  const [canRead, canGenerate] = await Promise.all([canReadCases(policy, mode), canGenerateDocument(policy, mode)]);
  if (!canRead || !canGenerate) return NextResponse.json({ error: 'Not authorized to create documents for this case.' }, { status: 403 });

  try {
    if (b.action === 'preview') {
      const pdf = await previewManateeApplication(organizationId, caseId, values, mode);
      return new NextResponse(Buffer.from(pdf), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'Cache-Control': 'no-store' },
      });
    }
    const document = await saveManateeApplication(
      organizationId,
      caseId,
      values,
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      mode,
    );
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Could not create the Manatee County application. Please try again.');
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof ManateeApplicationError) return NextResponse.json({ error: error.message }, { status: error.status });
  // The message only — never the values, which can include an SSN.
  console.error('Manatee County application failed:', error instanceof Error ? error.name : 'unknown error');
  return NextResponse.json({ error: fallback }, { status: 500 });
}

const str = (value: unknown, max = 120) => (typeof value === 'string' ? value.slice(0, max) : null);
const int = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function parseInput(raw: unknown): ManateeApplicationInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const textKeys = [
    'decedentFirst', 'decedentMiddle', 'decedentLast', 'dateOfDeath', 'placeOfDeathCity', 'placeOfDeathCounty',
    'spouseFirst', 'spouseMiddle', 'spouseLast', 'representedName', 'representedRelationship',
  ] as const;
  const out: Record<string, unknown> = {};
  for (const key of textKeys) {
    const value = str(r[key]);
    if (value === null) return null;
    out[key] = value;
  }
  const withCause = int(r.withCause);
  const withoutCause = int(r.withoutCause);
  if (withCause === null || withoutCause === null) return null;
  if (typeof r.fedexFee !== 'boolean' || typeof r.ssnNotKnown !== 'boolean') return null;
  if (r.ssn !== undefined && r.ssn !== null && typeof r.ssn !== 'string') return null;
  const requestNumber = r.requestNumber === undefined ? '' : str(r.requestNumber, 4);
  const requestOf = r.requestOf === undefined ? '' : str(r.requestOf, 4);
  if (requestNumber === null || requestOf === null) return null;
  return {
    ...(out as Omit<ManateeApplicationInput, 'withCause' | 'withoutCause' | 'fedexFee' | 'ssnNotKnown' | 'ssn' | 'requestNumber' | 'requestOf'>),
    withCause,
    withoutCause,
    fedexFee: r.fedexFee,
    ssnNotKnown: r.ssnNotKnown,
    ssn: typeof r.ssn === 'string' ? r.ssn.slice(0, 20) : null,
    requestNumber,
    requestOf,
  };
}
