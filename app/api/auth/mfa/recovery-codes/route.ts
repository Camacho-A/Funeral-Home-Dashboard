import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { regenerateRecoveryCodes } from '@/services/mfaService';

/**
 * Phase 40. Regenerates the recovery-code batch (old codes stop working),
 * gated by a current TOTP code. Returns the new codes once; only hashes are
 * stored.
 */
export async function POST(request: Request) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, dataAdapterMode } = access;

  if (!identity.mfaEnabled) return NextResponse.json({ error: 'Two-factor authentication is not enabled.' }, { status: 409 });

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const code = typeof parsed.body.code === 'string' ? parsed.body.code.trim() : '';
  if (code.length === 0) return NextResponse.json({ error: 'A verification code is required.' }, { status: 400 });

  const result = await regenerateRecoveryCodes(identity.id, code, dataAdapterMode);
  if (!result.success) return NextResponse.json({ error: 'That code was not correct.' }, { status: 400 });
  return NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes });
}
