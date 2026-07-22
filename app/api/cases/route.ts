import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems, insertWixDataItem } from '@/lib/wixDataApi';
import { mapWixCaseItem, buildWixCaseData, type WixCaseItem } from '@/lib/wixCaseMapper';
import { fetchWixWorkflowTemplates } from '@/lib/wixWorkflowTemplateMapper';
import { latestTemplateVersion, buildCaseWorkflowSnapshot } from '@/domain/workflow/snapshot';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { matchesSearch } from '@/services/casesService';
import type { Case } from '@/types/case';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';

/**
 * Phase 15C (Wix Case Read Integration). Lists cases for one organization
 * — see docs/adr/ADR-013-wix-case-read-integration.md.
 *
 * In mock mode: filters services/__mocks__/fixtures.ts's caseFixtures by
 * organizationId (excluding soft-deleted) plus the optional search query —
 * byte-for-byte the same logic services/casesService.ts's list() always
 * ran. In practice, `casesService.list()` never actually calls this route
 * while dataAdapterMode is "mock" (it takes a local, zero-network path
 * instead, to stay consistent with create()/update()'s client-side
 * fixture mutations — see ADR-013) — this branch exists for defense-in-
 * depth and independent testability, matching every other Phase 15
 * Route Handler's symmetric mock/wix shape.
 *
 * In wix mode: queries the `cases` collection filtered by organizationId
 * and isArchived=false, maps each item via lib/wixCaseMapper.ts (skipping
 * malformed records rather than throwing), then applies the same search
 * filter server-side.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  const searchQuery = url.searchParams.get('searchQuery') ?? '';

  if (!requestedOrganizationId) {
    return NextResponse.json({ cases: [], error: 'organizationId is required.' }, { status: 400 });
  }

  // Phase 15X (Multi-Tenant Authorization Hardening): re-derived from the
  // caller's session/membership, never trusted from the query param.
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const adapter = getDataAdapterMode();

  if (adapter === 'mock') {
    const cases = caseFixtures.filter(
      (c) => c.organizationId === organizationId && !c.isDeleted && matchesSearch(c, searchQuery),
    );
    return NextResponse.json({ cases });
  }

  try {
    const response = await queryWixDataItems<WixCaseItem>('cases', {
      filter: { organizationId, isArchived: false },
    });

    const cases = response.dataItems
      .map((item) => mapWixCaseItem(item.data))
      .filter((c): c is Case => c !== null)
      .filter((c) => matchesSearch(c, searchQuery));

    return NextResponse.json({ cases });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ cases: [], error: message }, { status: 503 });
  }
}

/**
 * Phase 16 (Wix Write Integration). Creates a case, persisted to Wix — see
 * docs/adr/ADR-016-wix-write-integration.md.
 *
 * organizationId arrives in the body only as a *requested* value;
 * requireAuthorizedOrganization re-derives the trusted one from the
 * caller's own session/membership, exactly like every read route. Every
 * other identity-shaped field this project doesn't yet have a real
 * server-side mapping for (createdBy, intakeOwnerId, and the
 * assignedStaffId default) is still sourced from the client's
 * useSession() — a deliberate, documented continuation of the existing
 * trust model (see the ADR's "Known limitation, not resolved here"), never
 * a new one. It is not a tenant/authorization boundary: organizationId is
 * the only value this handler treats as security-relevant, and that one
 * is never taken from the body.
 *
 * The workflow template is resolved entirely server-side — this
 * organization's first enabled template, exactly matching
 * hooks/useCreateCase.ts's existing "first enabled" selection rule — never
 * accepted from the request, so a case can never be created against
 * another organization's template or an unvalidated snapshot.
 *
 * This route requires DATA_ADAPTER=wix: mock-mode case creation stays on
 * casesService.create's existing client-side path (which never calls this
 * route at all — see services/casesService.ts), so there is no mock
 * branch to duplicate here. See the ADR for why this was a deliberate
 * simplification rather than an oversight.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ case: null, error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ case: null, error: 'Invalid request body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ case: null, error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  if (getDataAdapterMode() !== 'wix') {
    return NextResponse.json(
      { case: null, error: 'This endpoint requires DATA_ADAPTER=wix.' },
      { status: 400 },
    );
  }

  const requiredStringFields = ['decedentName', 'nextOfKinName', 'nextOfKinPhone', 'createdBy', 'intakeOwnerId'];
  const missingOrInvalid = requiredStringFields.filter(
    (key) => typeof b[key] !== 'string' || (b[key] as string).trim() === '',
  );
  if (missingOrInvalid.length > 0) {
    return NextResponse.json(
      { case: null, error: `Invalid or missing required field(s): ${missingOrInvalid.join(', ')}` },
      { status: 400 },
    );
  }
  const optionalStringFields = ['dateOfBirth', 'dateOfDeath', 'timeOfDeath', 'placeOfDeath', 'weight', 'assignedStaffId'];
  const badOptional = optionalStringFields.filter((key) => key in b && typeof b[key] !== 'string');
  if (badOptional.length > 0) {
    return NextResponse.json(
      { case: null, error: `Invalid field(s): ${badOptional.join(', ')}` },
      { status: 400 },
    );
  }
  if ('fieldValues' in b && (typeof b.fieldValues !== 'object' || b.fieldValues === null || Array.isArray(b.fieldValues))) {
    return NextResponse.json({ case: null, error: 'Invalid field(s): fieldValues' }, { status: 400 });
  }

  try {
    const templates = await fetchWixWorkflowTemplates(organizationId);
    const template = templates.find((t) => t.isEnabled);
    if (!template) {
      return NextResponse.json(
        { case: null, error: `No enabled workflow template found for this organization.` },
        { status: 422 },
      );
    }
    const version = latestTemplateVersion(template);

    const beaconCaseId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const createdBy = b.createdBy as string;
    const intakeOwnerId = b.intakeOwnerId as string;
    const assignedStaffId = typeof b.assignedStaffId === 'string' ? b.assignedStaffId : createdBy;

    const data = buildWixCaseData({
      beaconCaseId,
      organizationId,
      caseType: version.caseTypes[0],
      workflowTemplateId: template.id,
      workflowTemplateVersion: version.version,
      workflowSnapshot: buildCaseWorkflowSnapshot(template, version),
      intakeOwnerId,
      createdBy,
      assignedStaffId,
      decedentName: b.decedentName as string,
      dateOfBirth: (b.dateOfBirth as string) ?? '—',
      dateOfDeath: (b.dateOfDeath as string) ?? '—',
      timeOfDeath: (b.timeOfDeath as string) ?? '—',
      placeOfDeath: (b.placeOfDeath as string) ?? '—',
      weight: (b.weight as string) ?? '—',
      nextOfKinName: b.nextOfKinName as string,
      nextOfKinPhone: b.nextOfKinPhone as string,
      fieldValues: (b.fieldValues as Record<number, string>) ?? {},
      createdAt,
    });

    const inserted = await insertWixDataItem<WixCaseItem>('cases', data, beaconCaseId);
    const created = mapWixCaseItem(inserted.data);
    if (!created) {
      return NextResponse.json({ case: null, error: 'Failed to create case.' }, { status: 500 });
    }

    return NextResponse.json({ case: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ case: null, error: message }, { status: 503 });
  }
}
