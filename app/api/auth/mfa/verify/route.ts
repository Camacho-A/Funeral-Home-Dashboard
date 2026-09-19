import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { verifyMfaEnrollment } from '@/services/mfaService';

/**
 * Phase 40. Step 2 of enrollment: proves possession of the enrolled secret
 * with a current TOTP code, enables MFA, and returns the 10 single-use
 * recovery codes ONCE (only their hashes are stored). MFA never becomes active
 * without this successful verification (approved requirement 4).
 */
export async function POST(request: Request) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, dataAdapterMode } = access;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const code = typeof parsed.body.code === 'string' ? parsed.body.code.trim() : '';
  if (code.length === 0) return NextResponse.json({ error: 'A verification code is required.' }, { status: 400 });

  const result = await verifyMfaEnrollment(identity.id, code, dataAdapterMode);
  if (!result.success) {
    return NextResponse.json({ error: 'That code was not correct.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes });
}
