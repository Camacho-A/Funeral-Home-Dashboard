import type { Identity } from '@/types/identity';

/**
 * Phase 33 (Real Notification Delivery). Client-side fetch wrappers
 * around `/api/auth/profile` — mirrors `lib/notificationsClient.ts`'s
 * own reasoning exactly (server-only services can never be imported into
 * a Client Component).
 */

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Request failed.');
  }
  return body;
}

/** Returns `null` for a 404 — expected, not exceptional, under
    `AUTH_ADAPTER='mock'|'wix'` (see the route's own comment: `Identity`
    is a Phase 21 identity-mode concept, so a mock/wix session's `userId`
    never resolves to one). Any other failure still throws. */
export async function fetchMyIdentityProfile(organizationId: string): Promise<Identity | null> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/auth/profile?${params.toString()}`);
  if (response.status === 404) return null;
  const body = await parseJsonOrThrow(response);
  return body.identity as Identity;
}

export async function updateMyPhone(organizationId: string, phone: string | null): Promise<Identity> {
  const response = await fetch('/api/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, phone }),
  });
  const body = await parseJsonOrThrow(response);
  return body.identity as Identity;
}
