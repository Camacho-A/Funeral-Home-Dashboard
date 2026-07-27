/**
 * Phase 21 (Identity, Authentication & Session Management). Login/account
 * activity audit trail — a collection this phase's own spec implies
 * ("Login Activity: Record... Track: identityId, organizationId,
 * timestamp, ipAddress, userAgent, eventType") but never explicitly names
 * in its "New Wix Collections" list, the same class of well-justified
 * addition as `webhookEvents` (Phase 19B), `caseOrderAuditEntries` (Phase
 * 19C), and `onboardingAuditEntries` (Phase 20) — flagged here for the
 * same reason each of those was flagged in its own ADR.
 */
export type LoginActivityEventType =
  | 'login_succeeded'
  | 'login_failed'
  | 'password_reset'
  | 'email_verified'
  | 'invitation_accepted'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'session_revoked';

export type LoginActivityEvent = {
  id: string;
  /** Null for a failed login against an email with no matching identity —
      "never reveal whether an email exists" means this event is still
      recorded, just without a resolvable identityId. */
  identityId: string | null;
  organizationId: string | null;
  eventType: LoginActivityEventType;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: string;
};
