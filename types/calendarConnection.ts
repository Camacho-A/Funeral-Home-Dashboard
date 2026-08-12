/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated Reminders).
 * A staff member's connected external calendar (Google or Microsoft),
 * one row per (staffProfileId, provider) — `id` is deterministic
 * (`${organizationId}-${staffProfileId}-${provider}`), which is what
 * enforces "at most one connection per staff member per provider" by
 * construction, mirroring `organizationMemberships`' own
 * application-enforced-uniqueness precedent (Wix Data has no
 * compound-unique index support).
 *
 * Keyed by `staffProfileId`, never `identityId` — this is a genuinely
 * new, *stored, operational* entity ("this staff member's calendar is
 * connected"), which under ADR-034's hard layering invariant must
 * terminate at `StaffProfile.id` exactly like
 * `Appointment.ownerStaffProfileId`/`Resource.linkedStaffProfileId` do.
 * `types/identityLayeringInvariant.test.ts` covers this file
 * accordingly. See
 * docs/adr/ADR-034-identity-model-hardening-and-staff-assignment-architecture.md
 * and docs/adr/ADR-038-scheduling-integrations-calendar-sync-and-reminders.md.
 *
 * `accessTokenCiphertext`/`refreshTokenCiphertext` are AES-256-GCM
 * ciphertext produced by `lib/identity/calendarTokenEncryption.ts` —
 * mirrors `identities.mfaSecretReference`'s exact encrypted-value
 * precedent (per-identity cardinality, decryptable only server-side),
 * deliberately not Clover's simpler env-var-reference-indirection
 * pattern (that only scales to a handful of per-organization secrets,
 * not per-staff-member ones). Never logged, never returned in any API
 * response.
 */
export type CalendarProviderName = 'google' | 'microsoft';

export type CalendarConnectionStatus = 'connected' | 'disconnected' | 'reauth_required' | 'error';

export type CalendarConnection = {
  id: string;
  organizationId: string;
  /** -> StaffProfile.id. See this file's own header comment for why. */
  staffProfileId: string;
  provider: CalendarProviderName;
  /** Display-only ("connected as jane@gmail.com") — never a secret. */
  externalAccountEmail: string;
  /** The specific calendar within the account synced to (e.g. "primary"). */
  externalCalendarId: string;
  status: CalendarConnectionStatus;
  /** Space-separated OAuth scope string, for audit/debug visibility only. */
  scopesGranted: string;
  /** Secret — AES-256-GCM ciphertext, never plaintext, never logged. */
  accessTokenCiphertext: string;
  /** Secret — AES-256-GCM ciphertext. Overwritten on every refresh;
      Microsoft rotates the refresh token on every use, so this must
      never be treated as a static value once issued. */
  refreshTokenCiphertext: string;
  /** Access-token expiry — the sync sweep proactively refreshes ahead
      of this rather than waiting for a request to fail. */
  tokenExpiresAt: string;
  connectedAt: string;
  disconnectedAt: string | null;
  lastSyncAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  /** Bounded, human-readable — never token material, never a raw
      provider stack trace. */
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewCalendarConnectionInput = {
  staffProfileId: string;
  provider: CalendarProviderName;
  externalAccountEmail: string;
  externalCalendarId: string;
  scopesGranted: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
};
