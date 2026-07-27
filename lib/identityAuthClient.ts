import type { IdentitySession } from '@/types/identitySession';

/**
 * Phase 21 (Identity, Authentication & Session Management). Client-side
 * fetch wrappers around this app's own `/api/auth/*` Route Handlers —
 * the one place identity-mode UI (components/settings/SecuritySettingsPanel.tsx)
 * is allowed to reach the server, since `services/identityService.ts` and
 * friends import `lib/wixDataApi.ts` (a server-only module holding
 * WIX_API_KEY) and can never be imported into a Client Component directly
 * — unlike services/workflowTemplatesService.ts, which is safe to import
 * client-side because its own mock-mode branch never touches a secret.
 */

export type SessionListItem = IdentitySession & { isCurrent: boolean };

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export async function fetchActiveSessions(): Promise<SessionListItem[]> {
  const response = await fetch('/api/auth/sessions');
  const body = await parseJsonOrThrow(response);
  return (body.sessions as SessionListItem[]) ?? [];
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  const response = await fetch(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  await parseJsonOrThrow(response);
}

export async function signOutEverywhere(): Promise<void> {
  const response = await fetch('/api/auth/sessions/sign-out-everywhere', { method: 'POST' });
  await parseJsonOrThrow(response);
}

export type MembershipListItem = {
  organizationId: string;
  displayName: string;
  role: string;
  isCurrent: boolean;
};

export async function fetchMyMemberships(): Promise<MembershipListItem[]> {
  const response = await fetch('/api/auth/memberships');
  const body = await parseJsonOrThrow(response);
  return (body.organizations as MembershipListItem[]) ?? [];
}

export async function switchOrganization(organizationId: string): Promise<void> {
  const response = await fetch('/api/auth/switch-organization', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  await parseJsonOrThrow(response);
}

export async function changePassword(params: {
  currentPassword: string;
  newPassword: string;
  keepCurrentSession: boolean;
}): Promise<{ signedOutEverywhere: boolean }> {
  const response = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return { signedOutEverywhere: body.signedOutEverywhere === true };
}
