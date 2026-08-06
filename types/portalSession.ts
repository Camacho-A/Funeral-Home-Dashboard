/**
 * Phase 29 (Family Portal & External Collaboration). The server-side
 * revocable registry for family sessions — mirrors `types/identitySession.ts`'s
 * shape, but references `PortalUser.id`, never `Identity.id`, and is
 * validated by its own resolver (`lib/auth/requireFamilySession.ts`),
 * never `lib/auth/resolveIdentitySession.ts`. Deliberately **not**
 * organization-scoped (unlike `IdentitySession.organizationId`) — a
 * Portal User's accessible cases are resolved per-request from
 * `PortalAccess`, never fixed at session-issue time, since one session
 * may cover access to more than one case.
 */
export type PortalSession = {
  id: string;
  portalUserId: string;
  deviceId: string;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  createdAt: string;
};
