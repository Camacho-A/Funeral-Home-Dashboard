# ADR-025: Identity & Authentication Architecture

**Status:** Accepted
**Date:** 2026-07-25

## Context

Every prior phase's authentication (Phase 13) was either a single hardcoded mock user or a real Wix Member logging in via OAuth — neither supports Beacon's own invitations, password resets, MFA, multi-device session management, or a person belonging to more than one organization without duplication. This phase builds Beacon's own identity system from scratch: email/password login, invitations, email verification, MFA, and full session lifecycle management — while leaving the existing `'mock'`/`'wix'` login paths completely untouched.

## A third `AUTH_ADAPTER` value, not a replacement

`AUTH_ADAPTER` gains `'identity'` alongside the existing `'mock'`/`'wix'` values (`lib/env.ts`) — the user's own explicit choice among three options when asked how the new system should relate to the existing switch. `'mock'` (hardcoded dev login) and `'wix'` (Wix Members OAuth) behave exactly as before, forever, whether or not `'identity'` is ever used. Every place that branches on session shape (`app/(portal)/layout.tsx`, `lib/auth/requireAuthorizedOrganization.ts`, `app/login/actions.ts`) adds a new `source === 'identity'` branch alongside the existing two, never modifying them.

## Identity and authorization remain separate types, on purpose

`types/identity.ts`'s `Identity` answers "who is this person" — email, display name, password/MFA state — and never resolves or grants organization permissions. `types/membership.ts`'s `Membership` answers "what may this identity do in this organization" — role, status, invited-by. Nothing in `services/identityService.ts` ever reads or writes a `Membership` row, and nothing in `services/membershipService.ts` ever reads or writes identity secrets. This mirrors the pre-existing split between `types/organization.ts`'s `OrganizationMembership` and the older per-user session shape, just made explicit and load-bearing for the first time.

**`Membership` deliberately coexists with, rather than replaces, the pre-existing `OrganizationMembership` model.** `AUTH_ADAPTER='mock'|'wix'` sessions and `lib/auth/authorize.ts`'s `resolveAuthorizationContext` keep reading `services/__mocks__/authFixtures.ts` exactly as before Phase 21 — zero behavioral change, verified by the full pre-existing test suite passing unchanged throughout this phase. `AUTH_ADAPTER='identity'` sessions resolve their organization access through a new, parallel function, `lib/auth/resolveMembershipAuthorizationContext.ts`, reading the `Membership` model instead. Both converge on the same `AuthorizationContext` shape (`{userId, organizationId, role}`), so every existing Route Handler's `requireAuthorizedOrganization` call needed exactly one new branch (dispatching on `session.user.source`) to support both models — not two parallel sets of Route Handlers.

## Two-layer session model

A stateless signed cookie alone (`lib/auth/sessionToken.ts`, unchanged since Phase 13) can prove a token was validly issued and hasn't hit its own expiry — it cannot be revoked before that expiry, cannot support "sign out everywhere," and cannot be listed as a device to the user. `AUTH_ADAPTER='identity'` sessions are validated by **both** layers:

1. The existing signed cookie (`AuthSession`, now carrying an optional `sessionId` claim, set only for `source: 'identity'`).
2. A new server-side registry row (`IdentitySession` / the `sessions` collection) that the cookie's `sessionId` points at — `lib/auth/resolveIdentitySession.ts` checks this row's `revokedAt`, `expiresAt` (sliding, extended on every validated request), and `passwordVersionAtIssue` against the identity's current `passwordVersion`.

This second check runs in `app/(portal)/layout.tsx` and `lib/auth/requireAuthorizedOrganization.ts` — the same defense-in-depth layer that already resolves organization membership — not in `middleware.ts`, which deliberately stays Wix/Node-crypto-free and edge-runtime-agnostic for all three auth modes (see `middleware.ts`'s own comment). A session that fails this check is treated exactly like no session at all: the stale cookie is cleared, not left for the browser to keep retrying with.

## Invitations are a Membership row, not a seventh collection

The spec's own invitation-flow diagram ("Invite Staff → Email sent → Accept Invitation → Verify Email → Create Password → Membership Activated") maps exactly onto a `Membership` row transitioning `status: 'invited'` → `'active'`. There is no dedicated invitations collection or type — `services/invitationService.ts`'s `inviteToOrganization` creates (or reuses) an `Identity` by email, then a `Membership` row with `status: 'invited'`, and issues an email-verification token via the same mechanism a plain signup uses (`services/emailVerificationService.ts`). "Membership Activated" is `activateMembership` flipping that same row to `'active'` and setting `joinedAt`. Re-inviting an already-invited or already-active email is idempotent (no duplicate row, no re-issued token) — verified by `services/invitationService.test.ts`.

## MFA secret storage: an encrypted value, not an env-var name

Every other per-tenant secret reference in this codebase (Clover's `merchantIdReference`/`credentialReference`) names an environment variable — practical for a handful of organizations, one env var each. A TOTP secret is per-*identity*, potentially thousands of them, so "reference" here means something different: `mfaSecretReference` is an AES-256-GCM encrypted value (base64 of `iv + authTag + ciphertext`), decryptable only via a server-only `MFA_ENCRYPTION_KEY` (`lib/identity/mfaSecretEncryption.ts`, following `lib/env.ts`'s existing `getSessionSecret` pattern: a clearly-insecure dev fallback outside production, a hard failure if unset in production). Recovery codes are generated once, shown to the user exactly once, and only their SHA-256 hashes are ever persisted (`mfaRecoveryCodeHashes`) — spliced out one at a time as each is consumed.

TOTP itself (RFC 6238/4226 — HMAC-SHA1, 30-second step, ±1 step drift tolerance, base32 encode/decode) is hand-rolled rather than adding a dependency, matching this project's existing preference for a small, auditable implementation over a new package for a well-specified, stable algorithm.

## Brute-force protection derives from the audit trail, not a separate counter

`services/accountRecoveryService.ts`'s lockout decision (`domain/identity/lockoutPolicy.ts`: 5 failed attempts within a 15-minute window locks the account for 15 minutes) counts `loginActivityEvents` rows directly rather than maintaining a separate failed-attempt counter field on `Identity`. The audit trail and the lockout decision can never drift apart from each other this way. The count is computed by fetching every `login_failed` event for the identity and filtering by timestamp in application code — deliberately not relying on an unverified Wix Data range-filter operator, consistent with this project's standing discipline of confirming Wix Data behavior empirically rather than assuming it.

`login_failed` events are recorded with `identityId: null` for an unknown email — the concrete mechanism behind "never reveal whether an email exists": the login action's response is identical either way, but the audit trail still records that *an* attempt happened.

## Password hashing and tokens

Password hashing uses Node's built-in `crypto.scryptSync` (`{saltHex}:{derivedKeyHex}`, constant-time comparison via `timingSafeEqual`) rather than adding a `bcrypt` dependency — same reasoning as TOTP above. Email-verification and password-reset tokens are `crypto.randomBytes(32)` raw values; only their SHA-256 hash is ever persisted, and comparison is constant-time. Both token types are single-use (`usedAt`) and collection-scoped separately (`emailVerificationTokens`/`passwordResetTokens`) rather than sharing one table, so a verification token and a reset token can never be confused with each other by type alone.

## Migration: parameterized, not hardcoded to one fixture module

`services/identityMigrationService.ts`'s `migrateExistingUsers` takes the legacy `(userId, email, displayName)` triples and `OrganizationMembership` rows to migrate as explicit parameters, rather than importing `services/__mocks__/authFixtures.ts` directly — mirroring `services/organizationProvisioningService.ts`'s `migrateExistingOrganization` (Phase 20), which takes its own input as an argument rather than reaching for one specific fixture module. For mock mode, the caller supplies `authFixtures.ts`'s three named users; the function itself has no opinion about where its input comes from.

**"No forced password resets," concretely:** a migrated identity is marked `emailVerified: true`/`status: 'active'` immediately (the legacy model already trusted this person) but given no password at all — there was never a Beacon-owned password to carry over. The first time a migrated person authenticates, they go through the ordinary forgot-password flow to *establish* their first password, not reset an existing one. **"No memberships lost":** every legacy membership row is carried over, active or not — an inactive legacy row becomes a `Membership` row with `status: 'disabled'` rather than being silently dropped, so an administrator can re-enable it later without re-inviting that person from scratch. The whole function is idempotent throughout (`findOrCreateIdentity` by email, `createMembership` by `(identityId, organizationId)`), confirmed by running it twice live against `DATA_ADAPTER=wix` — the second run created nothing new.

## A live schema collision, found and resolved during this phase

Phase 21's own `services/membershipService.ts`/`lib/wixMembershipMapper.ts` were designed under the belief that no live Wix collection named `organizationMemberships` existed yet (`lib/auth/authorize.ts`'s pre-existing comment, "no real Wix membership data collection exists yet," was accurate about *no code reading it* — not about the collection's existence: it was created back in Phase 14A and had sat empty and unread ever since). This was only caught at this phase's own live-verification step, flagged to the user before any live schema change was made rather than resolved unilaterally. The user's explicit choice: extend the existing collection's schema to serve both the legacy `userId`/`identitySource`/`isActive` row shape and the new `identityId`/`status`/`invitedBy`/`joinedAt` shape side by side, rather than route Phase 21 into a differently-named collection. See `docs/WIX_DATA_SCHEMA.md`'s Collection 2 section for the exact field-level resolution (which fields are shared, which were relaxed from `required: true`, and why) — the collection held zero rows at the time of the change, so there was no data-loss risk either way.

## What this phase deliberately defers

- **MFA login-time challenge.** `app/login/actions.ts`'s identity branch redirects with `mfa_required` rather than completing a two-step challenge for an identity with `mfaEnabled: true` — enrollment, verification, and recovery-code consumption are all fully built and tested (`services/mfaService.ts`), but the two-step *login* UX (password, then a separate code-entry step) needs state between those two requests that doesn't fit this phase's plain Server-Action form-post model, and wasn't built. Tracked as a known limitation, not silently ignored.
- **Transactional email.** No email provider is wired up anywhere in this codebase. `forgot-password`/`resend-verification`/invitation tokens are returned directly in the relevant response (mock mode: shown on the confirmation page; live: returned to the authenticated admin caller for invitations) rather than emailed — a known, disclosed gap, not a silent one.
- **A unified identity directory.** `StaffProfile` (case-assignee identity) and the new `Identity` (login identity) remain two separate concepts, exactly as `OrganizationMembership` and `Membership` do — unifying them is a larger, cross-cutting change out of this phase's scope.
