import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { activityContext, authorizeCrematory, crematoryErrorResponse } from '@/lib/crematory/routeAuth';
import {
  assignSourceDocument,
  buildCrematoryPackageNow,
  chooseCurrentPermit,
  confirmPackageName,
  confirmPermit,
  confirmReadyDate,
  getCrematoryCaseSummary,
  prepareCrematoryDocuments,
  recordPreviousSend,
} from '@/services/crematory/crematoryPackageService';

export const maxDuration = 60;

/**
 * Send to Crematory (2026-10) — one case.
 *   GET  → the case's readiness, permit, confirmed date and package
 *   POST { organizationId, action: 'confirm_permit', documentId }
 *        { organizationId, action: 'confirm_ready_date', date }
 *        { organizationId, action: 'confirm_package_name', first, last }
 *        { organizationId, action: 'build_package' }
 *        { organizationId, action: 'prepare' } → page 3 and the package
 *          prepared from what is already on the case (2026-10)
 *        { organizationId, action: 'assign_document', documentId, as: 'state_permit' | 'arrangement_forms' }
 *          → an untyped PDF already on the case, chosen by staff (2026-10)
 *        { organizationId, action: 'choose_current_permit', documentId }
 *          → where two permits are current, the one to keep (2026-10)
 *        { organizationId, action: 'record_previous_send', decision, method?, sentOn?, verification, confirmedChecked? }
 *          → a possible earlier send outside SOLIS, resolved by staff who
 *            may send (2026-10)
 * Nothing here sends anything.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const auth = await authorizeCrematory(new URL(request.url).searchParams.get('organizationId'), 'read');
  if (!auth.context) return auth.response;
  try {
    const summary = await getCrematoryCaseSummary(auth.context.organizationId, caseId, auth.canSend, auth.mode);
    return NextResponse.json({ ...summary, canPrepare: auth.canPrepare }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return crematoryErrorResponse(error, 'Could not load the crematory details. Please try again.');
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
  const auth = await authorizeCrematory(body.organizationId, 'prepare');
  if (!auth.context) return auth.response;
  const ctx = activityContext(auth.context, crypto.randomUUID());
  try {
    switch (body.action) {
      case 'confirm_permit':
        if (typeof body.documentId !== 'string') return NextResponse.json({ error: 'documentId is required.' }, { status: 400 });
        return NextResponse.json(await confirmPermit(ctx, caseId, body.documentId, auth.mode, auth.canSend));
      case 'confirm_ready_date':
        if (typeof body.date !== 'string') return NextResponse.json({ error: 'date is required.' }, { status: 400 });
        return NextResponse.json(await confirmReadyDate(ctx, caseId, body.date, auth.mode, auth.canSend));
      case 'confirm_package_name':
        return NextResponse.json(await confirmPackageName(ctx, caseId, { first: body.first, last: body.last }, auth.mode, auth.canSend));
      case 'build_package': {
        const { outcome, summary } = await buildCrematoryPackageNow(ctx, caseId, auth.mode, auth.canSend);
        return NextResponse.json({ outcome, summary }, { status: outcome === 'saved' ? 201 : 200 });
      }
      case 'prepare': {
        const result = await prepareCrematoryDocuments(ctx, caseId, auth.mode);
        return NextResponse.json({ result, summary: await getCrematoryCaseSummary(auth.context.organizationId, caseId, auth.canSend, auth.mode) });
      }
      case 'assign_document':
        if (typeof body.documentId !== 'string' || (body.as !== 'state_permit' && body.as !== 'arrangement_forms')) {
          return NextResponse.json({ error: "documentId and as ('state_permit' or 'arrangement_forms') are required." }, { status: 400 });
        }
        return NextResponse.json(await assignSourceDocument(ctx, caseId, body.documentId, body.as, auth.mode, auth.canSend));
      case 'choose_current_permit':
        if (typeof body.documentId !== 'string') return NextResponse.json({ error: 'documentId is required.' }, { status: 400 });
        return NextResponse.json(await chooseCurrentPermit(ctx, caseId, body.documentId, auth.mode, auth.canSend));
      case 'record_previous_send':
        // Deciding whether the crematory already has the documents is part of sending.
        if (!auth.canSend) return NextResponse.json({ error: 'You are not authorized to send documents to the crematory (ask an administrator for the Send Crematory Packages permission).' }, { status: 403 });
        return NextResponse.json(
          await recordPreviousSend(ctx, caseId, { decision: body.decision, method: body.method, sentOn: body.sentOn, verification: body.verification, confirmedChecked: body.confirmedChecked }, auth.mode, auth.canSend),
        );
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (error) {
    return crematoryErrorResponse(error, 'The change could not be saved. Nothing was sent. Please try again.');
  }
}
