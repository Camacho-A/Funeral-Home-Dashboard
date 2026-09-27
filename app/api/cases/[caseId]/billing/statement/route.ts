import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canGenerateDocument } from '@/services/authorizationPolicyService';
import { generateStatement, BillingDocumentServiceError } from '@/services/billingDocumentService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Item #1 fix (2026-09): a real PDF render (headless Chromium launch +
 * page render + PDF + Vercel Blob upload) can genuinely take longer than
 * a short default function timeout, especially on a cold start — this is
 * the one route in this codebase that does all of that synchronously in
 * one request. Scoped to this route only (not a global timeout increase);
 * see next.config.ts's serverExternalPackages for the companion fix that
 * makes the Chromium binary itself deployable at all.
 */
export const maxDuration = 60;

/**
 * Phase 39 (Family Billing & FTC Compliance). Generates (or regenerates) the
 * FTC Statement of Funeral Goods and Services Selected for a case, from its
 * authoritative CaseOrder. System-rendered — no template. Reuses
 * `document.generate` (a statement is a case document). Delegates all logic to
 * `billingDocumentService`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;
  const { caseId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; existingDocumentId?: unknown; requiredPurchaseExplanations?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (b.existingDocumentId !== undefined && typeof b.existingDocumentId !== 'string') {
    return NextResponse.json({ error: 'existingDocumentId must be a string if provided.' }, { status: 400 });
  }
  if (b.requiredPurchaseExplanations !== undefined && b.requiredPurchaseExplanations !== null && typeof b.requiredPurchaseExplanations !== 'string') {
    return NextResponse.json({ error: 'requiredPurchaseExplanations must be a string if provided.' }, { status: 400 });
  }

  const auth = await requireAuthorizedOrganization(b.organizationId);
  if (!auth.authorized) return auth.response;
  const { organizationId, userId, role } = auth.context;
  const mode = getDataAdapterMode();

  if (!(await canGenerateDocument({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return NextResponse.json({ error: 'Not authorized to generate documents for this case.' }, { status: 403 });
  }

  try {
    const { document } = await generateStatement(
      {
        caseId,
        existingDocumentId: b.existingDocumentId as string | undefined,
        requiredPurchaseExplanations: (b.requiredPurchaseExplanations as string | null | undefined) ?? null,
        idFactory: () => crypto.randomUUID(),
      },
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      mode,
    );
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    // BillingDocumentServiceError is a real, staff-actionable precondition
    // (today: "no active order") — its message is already written for a
    // staff reader and safe to return as-is.
    if (error instanceof BillingDocumentServiceError) return NextResponse.json({ error: error.message }, { status: 422 });

    // Item #1 fix (2026-09): anything else here is a renderer/storage
    // failure (e.g. a Chromium launch error, whose own message can
    // legitimately contain the executable path it tried to launch, or a
    // Blob-storage error) — this branch used to rethrow and fall through
    // to Next.js's own unhandled-error response. Log the real message
    // server-side only (bounded, no stack trace, no case/family data —
    // this route never had PII in scope to begin with) and return a
    // single fixed, sanitized message to the client.
    console.error('Statement PDF generation failed:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'Statement PDF could not be generated. Please try again.' }, { status: 500 });
  }
}
