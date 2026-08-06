import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { checkRateLimit } from '@/lib/rateLimiter';
import { listMessagesForCase, sendFamilyMessage } from '@/services/portal/portalMessagingService';

const MAX_BODY_LENGTH = 5000;
const RATE_LIMIT_ATTEMPTS = 20;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** Phase 29 (Family Portal & External Collaboration). Requires
    `message.read`/`message.send`. Delegates entirely to
    `services/portal/portalMessagingService.ts`. */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'message.read');
  if (!accessResult.authorized) return accessResult.response;

  const messages = await listMessagesForCase(accessResult.organizationId, accessResult.caseId, accessResult.dataAdapterMode);
  return NextResponse.json({ messages });
}

/** Rate-limited per `(portalUserId, caseId)` — refinement #13's own named
    basic limit for message-send. */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'message.send');
  if (!accessResult.authorized) return accessResult.response;

  const rateLimit = checkRateLimit(`family-message-send:${accessResult.portalUser.id}:${accessResult.caseId}`, RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { body?: unknown };
  if (typeof b.body !== 'string' || !b.body.trim() || b.body.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: `A non-empty message body (max ${MAX_BODY_LENGTH} characters) is required.` }, { status: 400 });
  }

  const message = await sendFamilyMessage(
    {
      organizationId: accessResult.organizationId,
      caseId: accessResult.caseId,
      portalUserId: accessResult.portalUser.id,
      portalAccessId: accessResult.access.id,
      relationshipType: accessResult.access.relationshipType,
      body: b.body,
      idFactory: () => crypto.randomUUID(),
    },
    accessResult.dataAdapterMode,
  );

  return NextResponse.json({ message }, { status: 201 });
}
