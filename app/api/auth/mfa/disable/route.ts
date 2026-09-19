import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { verifyMfaCode, verifyAndConsumeRecoveryCode, disableMfa } from '@/services/mfaService';

/**
 * Phase 40. Disables MFA — but only after proving possession with a current
 * TOTP code OR a single-use recovery code, so a hijacked (but MFA-unaware)
 * session cannot silently strip a user's second factor. (If the org requires
 * MFA, the enforcement layer will immediately prompt re-enrollment on the next
 * request — disabling never grants a policy bypass.)
 */
export async function POST(request: Request) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, dataAdapterMode } = access;

  if (!identity.mfaEnabled) return NextResponse.json({ ok: true });

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const code = typeof parsed.body.code === 'string' ? parsed.body.code.trim() : '';
  const useRecoveryCode = parsed.body.useRecoveryCode === true;
  if (code.length === 0) return NextResponse.json({ error: 'A verification code is required to disable two-factor authentication.' }, { status: 400 });

  const ok = useRecoveryCode
    ? await verifyAndConsumeRecoveryCode(identity.id, code, dataAdapterMode)
    : await verifyMfaCode(identity.id, code, dataAdapterMode);
  if (!ok) return NextResponse.json({ error: 'That code was not correct.' }, { status: 400 });

  await disableMfa(identity.id, dataAdapterMode);
  return NextResponse.json({ ok: true });
}
