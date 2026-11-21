/**
 * Phase 40 (MFA & Account Security). Thin, typed client wrappers for the
 * `/api/auth/mfa/*` and org MFA-policy routes. All mutating calls are
 * same-origin (CSRF-protected server-side). Secrets/recovery codes are handled
 * only in the enrolling user's own browser session and never persisted client
 * side.
 */
async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.');
  return body;
}
const jsonHeaders = { 'Content-Type': 'application/json' };

export type MfaStatus = { mfaEnabled: boolean; remainingRecoveryCodes: number };

export async function fetchMfaStatus(): Promise<MfaStatus> {
  const body = await parseJsonOrThrow(await fetch('/api/auth/mfa/status'));
  return { mfaEnabled: body.mfaEnabled === true, remainingRecoveryCodes: Number(body.remainingRecoveryCodes ?? 0) };
}

export async function beginMfa(): Promise<{ secret: string; otpauthUri: string }> {
  const body = await parseJsonOrThrow(await fetch('/api/auth/mfa/begin', { method: 'POST', headers: jsonHeaders }));
  return { secret: body.secret as string, otpauthUri: body.otpauthUri as string };
}

export async function verifyMfa(code: string): Promise<string[]> {
  const body = await parseJsonOrThrow(await fetch('/api/auth/mfa/verify', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code }) }));
  return (body.recoveryCodes as string[]) ?? [];
}

export async function disableMfa(code: string, useRecoveryCode = false): Promise<void> {
  await parseJsonOrThrow(await fetch('/api/auth/mfa/disable', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code, useRecoveryCode }) }));
}

export async function regenerateRecoveryCodes(code: string): Promise<string[]> {
  const body = await parseJsonOrThrow(await fetch('/api/auth/mfa/recovery-codes', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code }) }));
  return (body.recoveryCodes as string[]) ?? [];
}

export async function fetchOrgMfaPolicy(organizationId: string): Promise<boolean> {
  const body = await parseJsonOrThrow(await fetch(`/api/organization/mfa-policy?organizationId=${encodeURIComponent(organizationId)}`));
  return body.requireMfa === true;
}

export async function setOrgMfaPolicy(organizationId: string, requireMfa: boolean): Promise<boolean> {
  const body = await parseJsonOrThrow(await fetch('/api/organization/mfa-policy', { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ organizationId, requireMfa }) }));
  return body.requireMfa === true;
}

/** Portal-scoped MFA (Phase 5N): an administrator issues a one-time setup code for a member. Returned once. */
export async function issuePortalMfaSetupCode(organizationId: string, identityId: string): Promise<{ code: string; expiresAt: string }> {
  const response = await fetch('/api/auth/mfa/setup-grants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, identityId }) });
  const body = (await response.json().catch(() => ({}))) as { code?: string; expiresAt?: string; error?: string };
  if (!response.ok || !body.code || !body.expiresAt) throw new Error(body.error ?? 'The setup code could not be issued.');
  return { code: body.code, expiresAt: body.expiresAt };
}
