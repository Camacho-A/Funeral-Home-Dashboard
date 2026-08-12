/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated Reminders).
 * A revocable, unguessable token backing a subscribable ICS feed URL
 * (`GET /api/calendar-feed/[token]`). Only ever stores `tokenHash`
 * (SHA-256) — the plaintext token is returned exactly once, at
 * generation time, and never persisted anywhere. Mirrors
 * `EmailVerificationToken`'s hash-not-raw precedent exactly, and is
 * deliberately a *different* mechanism from `CalendarConnection`'s
 * AES-256-GCM-encrypted OAuth tokens: a feed token only ever needs
 * verification (does this hash match?), never decryption, so a one-way
 * hash is both simpler and strictly more secure than encryption here.
 *
 * Phase 34 baseline ships exactly one scope: `'staff_own'` — a staff
 * member's personal feed of their own owned appointments. See
 * docs/adr/ADR-038-scheduling-integrations-calendar-sync-and-reminders.md's
 * "ICS architecture" section for why org-wide/resource feeds are
 * deferred rather than built speculatively.
 */
export type CalendarFeedTokenScope = 'staff_own';

export type CalendarFeedToken = {
  id: string;
  organizationId: string;
  tokenHash: string;
  scope: CalendarFeedTokenScope;
  /** -> StaffProfile.id. Required for the only scope this phase ships. */
  ownerStaffProfileId: string;
  createdAt: string;
  revokedAt: string | null;
  lastAccessedAt: string | null;
};
