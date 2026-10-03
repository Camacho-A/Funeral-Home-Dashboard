import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditCase } from '@/services/authorizationPolicyService';
import { caseLogService } from '@/services/caseLogService';
import type { NewCaseLogEntryInput } from '@/types/caseLogEntry';

/**
 * Raw-field-name leak fix follow-up (2026-10) — the Case Log tab's only
 * path to the server. Previously `caseLogService.ts` had no API route at
 * all and was imported directly into Client Components, which only ever
 * worked because it did zero real I/O (see that service's own comment).
 *
 * GET is gated by `requireAuthorizedOrganization` alone, matching
 * `GET /api/cases/[caseId]/activity` exactly — no role in this codebase
 * can read a case's data but not its log (same ADR-028 reasoning).
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;

  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ entries: [], error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const dataAdapterMode = getDataAdapterMode();
  const entries = await caseLogService.list({ organizationId }, caseId, dataAdapterMode);
  return NextResponse.json({ entries });
}

/**
 * POST is gated by `canEditCase` — the same permission
 * `PATCH /api/cases/[caseId]` itself enforces for general case-data
 * mutations. Case Log entries (notes, "who did you call" contact logs)
 * are ordinary case management, not a specialized capability, so this
 * reuses that existing policy rather than inventing a new one.
 */
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

  const b = (body ?? {}) as Record<string, unknown>;
  const requestedOrganizationId = b.organizationId;
  if (typeof requestedOrganizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;

  const dataAdapterMode = getDataAdapterMode();
  const allowed = await canEditCase({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode);
  if (!allowed) {
    return NextResponse.json({ error: 'You do not have permission to edit this case.' }, { status: 403 });
  }

  if (typeof b.type !== 'string' || (b.type !== 'note' && b.type !== 'contact')) {
    return NextResponse.json({ error: '"type" must be "note" or "contact".' }, { status: 400 });
  }
  if (typeof b.author !== 'string' || b.author.trim() === '') {
    return NextResponse.json({ error: '"author" is required.' }, { status: 400 });
  }

  const input: NewCaseLogEntryInput = {
    type: b.type,
    text: typeof b.text === 'string' ? b.text : undefined,
    contactedWho: typeof b.contactedWho === 'string' ? b.contactedWho : undefined,
    contactedSpoke: typeof b.contactedSpoke === 'string' ? b.contactedSpoke : undefined,
    contactSummary: typeof b.contactSummary === 'string' ? b.contactSummary : undefined,
    author: b.author,
  };

  const entry = await caseLogService.create({ organizationId }, caseId, input, dataAdapterMode);
  return NextResponse.json({ entry }, { status: 201 });
}
