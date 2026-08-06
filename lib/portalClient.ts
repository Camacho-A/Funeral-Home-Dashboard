import type { PortalInvitation } from '@/types/portalInvitation';
import type { PortalAccess } from '@/types/portalAccess';
import type { PortalMessage } from '@/types/portalMessage';
import type { PortalRelationshipType } from '@/domain/portal/portalRelationshipRegistry';

/**
 * Phase 29 (Family Portal & External Collaboration). Client-side fetch
 * wrappers around the staff-side `/api/cases/[caseId]/portal-invitations`,
 * `/portal-access`, and `/portal-messages` routes — same
 * `parseJsonOrThrow` convention as every other `lib/*Client.ts` module
 * (see `lib/appointmentsClient.ts`'s own header comment for why these
 * wrappers exist at all: the underlying services import server-only
 * `lib/wixDataApi.ts` and can never be called from a Client Component).
 */

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export async function fetchPortalInvitations(organizationId: string, caseId: string): Promise<PortalInvitation[]> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/portal-invitations?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.invitations as PortalInvitation[]) ?? [];
}

export async function issuePortalInvitation(params: {
  organizationId: string;
  caseId: string;
  email: string;
  displayName: string;
  relationshipType: PortalRelationshipType;
}): Promise<PortalInvitation> {
  const { caseId, ...rest } = params;
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/portal-invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  });
  const body = await parseJsonOrThrow(response);
  return body.invitation as PortalInvitation;
}

export async function revokePortalInvitationRequest(params: { organizationId: string; caseId: string; invitationId: string }): Promise<PortalInvitation> {
  const response = await fetch(
    `/api/cases/${encodeURIComponent(params.caseId)}/portal-invitations/${encodeURIComponent(params.invitationId)}?organizationId=${encodeURIComponent(params.organizationId)}`,
    { method: 'DELETE' },
  );
  const body = await parseJsonOrThrow(response);
  return body.invitation as PortalInvitation;
}

export async function fetchPortalAccess(organizationId: string, caseId: string): Promise<PortalAccess[]> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/portal-access?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.access as PortalAccess[]) ?? [];
}

export async function setPortalAccessAction(params: {
  organizationId: string;
  caseId: string;
  accessId: string;
  action: 'disable' | 'revoke';
}): Promise<PortalAccess> {
  const response = await fetch(`/api/cases/${encodeURIComponent(params.caseId)}/portal-access/${encodeURIComponent(params.accessId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: params.organizationId, action: params.action }),
  });
  const body = await parseJsonOrThrow(response);
  return body.access as PortalAccess;
}

export async function fetchPortalMessages(organizationId: string, caseId: string): Promise<PortalMessage[]> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/portal-messages?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.messages as PortalMessage[]) ?? [];
}

export async function sendPortalStaffMessage(params: { organizationId: string; caseId: string; body: string }): Promise<PortalMessage> {
  const response = await fetch(`/api/cases/${encodeURIComponent(params.caseId)}/portal-messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: params.organizationId, body: params.body }),
  });
  const body = await parseJsonOrThrow(response);
  return body.message as PortalMessage;
}
