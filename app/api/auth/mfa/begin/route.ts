import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { beginMfaEnrollment } from '@/services/mfaService';

/**
 * Phase 40 (MFA & Account Security). Step 1 of enrollment: generates and
 * stores (AES-encrypted) a fresh TOTP secret and returns it once — as the raw
 * base32 secret and an `otpauth://` URI for QR rendering — WITHOUT enabling MFA
 * (enabling requires proving possession, see /verify). The plaintext secret is
 * returned to the enrolling user's own authenticated browser only, never
 * logged or persisted in plaintext. Self-service (any authenticated identity).
 */
export async function POST(request: Request) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, dataAdapterMode } = access;

  if (identity.mfaEnabled) {
    return NextResponse.json({ error: 'Two-factor authentication is already enabled.' }, { status: 409 });
  }

  const { secret } = await beginMfaEnrollment(identity.id, dataAdapterMode);
  const label = encodeURIComponent(`Beacon:${identity.email}`);
  const otpauthUri = `otpauth://totp/${label}?secret=${secret}&issuer=Beacon&algorithm=SHA1&digits=6&period=30`;
  return NextResponse.json({ secret, otpauthUri });
}
