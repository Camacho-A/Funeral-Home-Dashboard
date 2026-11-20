import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getDataAdapterMode } from '@/lib/env';
import { canEditCase, canReadCases } from '@/services/authorizationPolicyService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { changeServicePreparation, getServicePreparation, ServicePreparationError } from '@/services/servicePreparationService';
import { evaluateCremationReleaseForCaller } from '@/services/cremationReleaseService';
import { medicalExaminerApprovalView } from '@/services/medicalExaminerApprovalService';
import { loadCaseOnServer } from '@/services/serverCaseLoader';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import type { PreparationChange } from '@/domain/servicePreparation/preparationUpdates';
import type { PreparationStatus } from '@/domain/servicePreparation/types';

/**
 * Service preparation (Gus Phase 5C, 2026-11) — one case.
 *   GET  ?organizationId= → the case's preparation, its service appointment,
 *        its documents, and the release-for-cremation check for the person
 *        asking (case.read). Release itself is not active.
 *   POST { organizationId, change, basis: { at } } → one change (case.update):
 *        change = { kind: 'item', itemId, status, note?, documentId? }
 *               | { kind: 'choice', choice, value }
 *               | { kind: 'detail', key, value }
 *        reason — required while the release is on hold (Gus, 2026-11).
 * 409 when someone else changed the same entry (the latest comes back as
 * `preparation`) or the case is archived. Never completes a workflow or
 * legal step and never sends anything.
 */
const STATUSES: readonly PreparationStatus[] = ['pending', 'awaiting_confirmation', 'confirmed', 'completed', 'not_requested', 'attention_needed'];
const MAX_KEY = 100;
const MAX_TEXT = 300;

const str = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);

function parseChange(raw: unknown): PreparationChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (c.kind === 'item') {
    const itemId = str(c.itemId, MAX_KEY);
    if (!itemId || !STATUSES.includes(c.status as PreparationStatus)) return null;
    if (c.note !== undefined && c.note !== null && (typeof c.note !== 'string' || c.note.length > MAX_TEXT)) return null;
    if (c.documentId !== undefined && c.documentId !== null && !str(c.documentId, MAX_KEY)) return null;
    return {
      kind: 'item',
      itemId,
      status: c.status as PreparationStatus,
      ...(c.note !== undefined ? { note: c.note as string | null } : {}),
      ...(c.documentId !== undefined ? { documentId: c.documentId as string | null } : {}),
    };
  }
  if (c.kind === 'choice') {
    const choice = str(c.choice, MAX_KEY);
    const value = str(c.value, MAX_KEY);
    return choice && value ? { kind: 'choice', choice, value } : null;
  }
  if (c.kind === 'detail') {
    const key = str(c.key, MAX_KEY);
    return key && typeof c.value === 'string' && c.value.length <= MAX_TEXT ? { kind: 'detail', key, value: c.value } : null;
  }
  return null;
}

function errorResponse(error: unknown) {
  if (error instanceof ServicePreparationError) {
    return NextResponse.json({ error: error.message, ...(error.current ? { preparation: error.current } : {}) }, { status: error.status });
  }
  console.error('Service preparation request failed:', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: 'Could not save the preparation. Please try again.' }, { status: 500 });
}

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requested = new URL(request.url).searchParams.get('organizationId');
  if (!requested) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const auth = await requireAuthorizedOrganization(requested);
  if (!auth.authorized) return auth.response;
  const { organizationId, userId, role } = auth.context;
  const mode = getDataAdapterMode();
  if (!(await canReadCases({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return NextResponse.json({ error: 'Not authorized to view this case.' }, { status: 403 });
  }
  try {
    const preparation = await getServicePreparation(organizationId, caseId, mode);
    if (!preparation) return NextResponse.json({ error: 'This case has no service preparation.' }, { status: 404 });
    const [canEdit, release, case_] = await Promise.all([
      canEditCase({ identityId: userId, organizationId, roleKey: role }, mode),
      evaluateCremationReleaseForCaller({ organizationId, userId, role }, caseId, mode),
      loadCaseOnServer(organizationId, caseId, mode),
    ]);
    const medicalExaminer = case_ && getRegisteredOrganizationProfile(organizationId).features.funeralDirectorCredentials ? medicalExaminerApprovalView(case_) : null;
    return NextResponse.json({ preparation, canEdit, release, medicalExaminer }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { caseId } = await params;
  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const auth = await requireAuthorizedOrganization(body.organizationId);
  if (!auth.authorized) return auth.response;
  const { organizationId, userId, role } = auth.context;
  const mode = getDataAdapterMode();
  if (!(await canEditCase({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return NextResponse.json({ error: 'Not authorized to change this case.' }, { status: 403 });
  }

  const change = parseChange(body.change);
  if (!change) return NextResponse.json({ error: 'change is missing or malformed.' }, { status: 400 });
  const basisRaw = body.basis as { at?: unknown } | undefined;
  if (!basisRaw || typeof basisRaw !== 'object' || !(basisRaw.at === null || typeof basisRaw.at === 'string')) {
    return NextResponse.json({ error: 'basis.at is required (null when the entry was never set).' }, { status: 400 });
  }
  if (body.reason !== undefined && body.reason !== null && (typeof body.reason !== 'string' || body.reason.length > MAX_TEXT)) {
    return NextResponse.json({ error: 'reason must be text of up to 300 characters.' }, { status: 400 });
  }

  const correlationId = crypto.randomUUID();
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId };
  try {
    const actorName = (await resolveStaffProfileForCaller({ organizationId, userId, role }, mode))?.displayName ?? null;
    const preparation = await changeServicePreparation(ctx, caseId, { change, basis: { at: basisRaw.at as string | null }, actorName, reason: (body.reason as string | null | undefined) ?? null }, mode);
    return NextResponse.json({ preparation });
  } catch (error) {
    return errorResponse(error);
  }
}
