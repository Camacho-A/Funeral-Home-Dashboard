# ADR-044 — MFA & Account Security (Phase 40)

Status: Accepted · Builds on ADR-025 (Identity, Authentication & Session Management, Phase 21).

## Context

Phase 21 built a complete TOTP-MFA service (`services/mfaService.ts`): enrollment, verification, 10 single-use recovery codes (hashed at rest), an AES-256-GCM-encrypted secret — but it was **orphaned**. No UI could enable it, the login form **refused** an `mfaEnabled` account with an `mfa_required` redirect, there was no login-time challenge, and no org enforcement. Staff-login rate limiting existed only as per-account lockout on the identity path. Phase 40 wires the missing pieces so MFA is actually usable and enforceable, reusing the existing secret-encryption/recovery-code foundation unchanged. Scope (approved): TOTP only; org require-MFA policy; recovery codes; staff-login rate limiting. Deferred: trusted devices, admin-assisted MFA reset, SMS/email OTP, WebAuthn/SSO.

## Decisions

### 1. A non-session MFA challenge token enforces the auth boundary
After a correct password, when MFA is required, the login action issues a short-lived (5-minute), signed, **non-session** "challenge pending" token (`lib/auth/mfaChallengeToken.ts`, `beacon_mfa_challenge` cookie) and hands off to `/login/mfa`. Possessing this token grants exactly one capability — to attempt the second factor for one identity — and is never accepted as authentication by any protected route (`getSession`/middleware never look at it). A full `IdentitySession` is minted **only** after the factor verifies (`submitMfaChallenge`). This enforces the approved rule: *password verification alone must not create a fully authenticated session when MFA is required.* The token uses a distinct `aud` claim and key-derivation context, cryptographically separate from the staff and family session tokens (isolation test-enforced).

### 2. Enrollment requires proof; recovery codes are single-use and non-recoverable
Enrollment is two-step (`/api/auth/mfa/begin` → `/verify`): MFA never becomes active without a successful TOTP verification. Recovery codes are generated once, shown once, and only their hashes are stored; each is single-use. A new `regenerateRecoveryCodes` (TOTP-gated) replaces the batch. Disabling MFA also requires a current TOTP or recovery code, so a hijacked (MFA-unaware) session cannot silently strip the second factor. **No plaintext secret, code, recovery code, or session token is ever logged** (structural test-enforced).

### 3. Org require-MFA is a policy flag, enforced at login, never a lock-out
`Organization.requireMfa` (additive, nullable, default false — every pre-Phase-40 org is backward compatible and unaffected). Enforcement (`services/mfaPolicyService.ts` + the login action): a member of a require-MFA org who isn't enrolled is routed to `/settings/security` to enroll — **never hard-locked out** (approved requirement 5). Set via an `organization.manage`-gated route. RBAC and MFA state stay **separate** (requirement 9): the MFA service/policy import no permission layer, and RBAC never reads MFA state.

### 4. Staff-login rate limiting is the existing persistent account lockout, extended to the challenge
Server-authoritative account lockout (`domain/identity/lockoutPolicy.ts`: 5 failures / 15 min, persisted via `loginActivityEvents` + `Identity.status='locked'`) now also counts **failed MFA-challenge attempts** — a brute-forced second factor trips the same lockout as a brute-forced password (test-enforced). This is the appropriate server-authoritative mechanism for Beacon's serverless model (the process-local `lib/rateLimiter.ts` remains a disclosed, WAF-supplemented layer).

### 5. Family Portal authentication is untouched and isolated
The Family Portal auth stack (`PortalUser`, `familySessionToken`, `requireFamilyAccess`) is a wholly separate population with no MFA concept. It imports no staff MFA module and never reads org require-MFA (requirement 7, structural test-enforced). The challenge cookie/token is cross-rejected by the family verifier and vice versa.

### 6. No trusted-device implementation (D-deferred)
The existing `rememberDevice` flag only extends session TTL; it never skips MFA. A trusted-device "skip MFA for N days" tier is explicitly deferred (would add a device-registry collection).

## Storage & live surface
MFA state already lives on the `identities` collection (`mfaEnabled`, and the secret fields `mfaSecretReference`/`mfaVerifiedAt`/`mfaRecoveryCodeHashes` via the identity-secrets accessor). The one additive live change is **`organizations.requireMfa`** (Boolean, nullable, default false). The challenge is a stateless signed cookie — **no new collection**. Login-attempt/lockout persistence reuses the existing `loginActivityEvents`.

## Structural invariants (test-enforced)
Challenge token ≠ session (distinct audience/key, cross-verifier isolation); family auth imports no staff MFA module; MFA paths log no secret/code/token; MFA service/policy import no RBAC; failed challenges feed the persistent lockout; enrollment requires TOTP proof; recovery codes single-use.
