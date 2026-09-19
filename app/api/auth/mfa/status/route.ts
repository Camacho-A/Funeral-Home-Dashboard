import { NextResponse } from 'next/server';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { countRemainingRecoveryCodes } from '@/services/mfaService';

/**
 * Phase 40. Read-only MFA status for the account-security UI: whether MFA is
 * enabled and how many recovery codes remain. Never returns secrets or codes.
 */
export async function GET() {
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, dataAdapterMode } = access;
  const remainingRecoveryCodes = identity.mfaEnabled ? await countRemainingRecoveryCodes(identity.id, dataAdapterMode) : 0;
  return NextResponse.json({ mfaEnabled: identity.mfaEnabled, remainingRecoveryCodes });
}
