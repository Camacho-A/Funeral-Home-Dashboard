# Authentication & Organizations (Phase 13)

This document describes Beacon's authentication and organization-authorization foundation: how login/logout work in both mock and Wix modes, how organization access is resolved and enforced, what's required in the Wix dashboard to activate real login, and what's deliberately still missing. See [ADR-008](./adr/ADR-008-authentication-and-organizations.md) for why this shape was chosen.

## Authentication flow (plain text diagram)

```
Browser                    middleware.ts              app/(portal)/layout.tsx        Server Action / route
───────                    ─────────────              ────────────────────────       ─────────────────────

GET /dashboard  ─────────► reads beacon_session
                            cookie, verifies it
                            (Web Crypto HMAC)
                              │
                    no/invalid session?
                              │
                    307 → /login?next=/dashboard
                              │
◄─────────────────────────────

GET /login?next=/dashboard
 renders login form
 (mock: email+password;
  wix: same form, same
  fields — the action
  branches on AUTH_ADAPTER,
  independent of DATA_ADAPTER)

POST /login (form submit) ────────────────────────────────────────► loginAction (Server Action)
                                                                       │
                                                    mock: verifyMockCredentials(email, password)
                                                    wix:  loginWithWix(email, password)
                                                            → client.auth.login()
                                                            → getMemberTokensForDirectLogin()
                                                            → members.getCurrentMember()
                                                       (Wix tokens used once here, then discarded —
                                                        never persisted, never sent to the browser)
                                                                       │
                                                          success? createSession(user)
                                                          → signs a beacon_session cookie
                                                          (httpOnly, secure in prod, sameSite=lax)
                                                                       │
                                                          redirect(sanitized `next`)
◄──────────────────────────────────────────────────────────────────────

GET /dashboard  ─────────► valid session now    ────────► getSession() (defense-in-depth re-check)
                            → NextResponse.next()          → resolveAuthorizationContext(session)
                                                              → looks up ACTIVE memberships for
                                                                session.user.id (mock fixtures today)
                                                              → exactly one active membership?
                                                                auto-select it
                                                              → grants AuthorizationContext
                                                                { userId, organizationId, role }
                                                                       │
                                                          <OrganizationProvider organizationId={...}>
                                                            (existing pages/services unchanged —
                                                             they still just call useOrganization())
                                                                       │
◄────────────────────────────────────────────────────────── renders Dashboard, exactly as before

POST /  (Sign out button) ────────────────────────────────────────► logoutAction (Server Action)
                                                                       │
                                                              clearSession() — deletes the cookie
                                                                       │
                                                          redirect('/login')
◄──────────────────────────────────────────────────────────────────────
```

## Authorization and organization resolution

Two independent checks must both pass before any portal page renders:

1. **Is there a valid session?** (`middleware.ts`, then re-checked in `app/(portal)/layout.tsx` — deliberate defense-in-depth, not reliance on a single gate.) A session is a signed, HMAC-verified token (`lib/auth/sessionToken.ts`) stored in an httpOnly cookie. Invalid, tampered, or expired sessions are all treated identically: redirect to `/login`.
2. **Does this user have active access to an organization?** (`lib/auth/authorize.ts`'s `resolveAuthorizationContext`.) This is where "never trust organizationId supplied by the browser as proof of authorization" is actually enforced: the function never accepts an organizationId as truth on its own — it always looks up the session user's own membership rows and only grants access to an organization that lookup actually confirms. A request claiming an organizationId the user has no active membership in is rejected (`organization_mismatch`), regardless of how plausible the claimed id looks.

With exactly one active membership (today's default mock user), it's auto-selected — no UI needed. With more than one and no explicit selection, `resolveAuthorizationContext` returns `selection_required` rather than guessing; this phase doesn't build a switcher UI, just the mechanism a future one would call into.

**What "membership data" means today:** organization membership data always lives in `services/__mocks__/authFixtures.ts`, regardless of `DATA_ADAPTER` or `AUTH_ADAPTER` — there is no Wix data collection for organization memberships (creating one is out of this phase's scope). A real Wix member can log in for real (if `AUTH_ADAPTER=wix` and an OAuth app exists — see below), but their organization access is *not yet* resolved from anything Wix-hosted; see "Known limitations."

**Platform administrator (Phase 20 — Organization Onboarding & Tenant Provisioning):** a third, deliberately separate authorization concept, distinct from `OrganizationRole` — creating a brand-new tenant (`POST /api/onboarding/start`) happens *before* any `OrganizationMembership` can exist for it, so it can't be gated by `resolveAuthorizationContext` at all. `lib/auth/platformAdmin.ts`'s `isPlatformAdminUser` checks a session's `userId` against a plain comma-separated allowlist (`PLATFORM_ADMIN_USER_IDS`) — no new role, no granular permission system, matching this project's existing "deliberately small" philosophy. Every other onboarding route is gated differently (`lib/auth/requireOnboardingAccess.ts`'s `requireOnboardingSessionAccess`): authorized if the caller is a platform administrator, the specific user who started that session, or already holds an owner/administrator membership in its organization. See [ADR-024](./adr/ADR-024-organization-onboarding-tenant-provisioning.md).

## Files created

| File | Purpose |
|---|---|
| `types/auth.ts` | `AuthenticatedUser`, `AuthSession` |
| `types/authorization.ts` | `AuthorizationContext` — the only trusted organizationId/role pairing |
| `lib/auth/sessionToken.ts` | Signs/verifies the session token (Web Crypto HMAC-SHA256) — works identically in edge middleware and Node Server Actions |
| `lib/auth/session.ts` | The httpOnly cookie read/write wrapper (`next/headers`) |
| `lib/auth/mockAuth.ts` | Mock credential verification |
| `lib/auth/wixAuth.ts` | Real Wix member login (custom-login-page flow) — **untested against a live project**, see below |
| `lib/auth/authorize.ts` | `resolveAuthorizationContext` — the organization-access enforcement |
| `lib/auth/redirect.ts` | Open-redirect-safe `next` parameter validation |
| `services/__mocks__/authFixtures.ts` | Mock users, organizations, and memberships |
| `app/login/page.tsx`, `page.module.css` | The login form (mode-aware button label/hint, identical fields either way) |
| `app/login/actions.ts` | `loginAction`, `logoutAction` (Server Actions — CSRF-protected by Next.js's own Origin check) |
| `middleware.ts` | Route protection for everything except `/login` and `/api/*` |
| 8 test files | See "Testing" below |

## Files modified

| File | Change |
|---|---|
| `types/organization.ts` | Added `Organization`, `OrganizationMembership`, `OrganizationRole` |
| `hooks/useOrganization.tsx` | `OrganizationProvider` now accepts an `organizationId` prop instead of a hardcoded constant |
| `app/(portal)/layout.tsx` | Resolves the session and authorization context server-side; supplies the real `organizationId` to `OrganizationProvider` |
| `components/layout/TopBar.tsx`, `.module.css` | Added a "Sign out" control (a form posting to `logoutAction`) |
| `lib/env.ts` | Added `getSessionSecret()`, `getWixOAuthClientId()` |
| `package.json` | Added `@wix/members` |

## Packages installed

- `@wix/members` (member identity resolution for real-mode login — `getCurrentMember()`)

No other new package. Session signing uses the platform's own Web Crypto API, not a JWT library.

## Environment variables introduced

| Variable | Public/Private | Notes |
|---|---|---|
| `SESSION_JWT_SECRET` | **Private** | HMAC key for Beacon's own session cookie — reuses the name reserved in `.env.example` since Phase 0. Falls back to a fixed, clearly-insecure development value outside production (so mock mode needs zero new configuration); **throws in production if unset** |
| `WIX_OAUTH_CLIENT_ID` | Private-ish (a client ID, not a secret by Wix's own design — headless member OAuth needs no client secret) | Required only when `AUTH_ADAPTER=wix` |
| `AUTH_ADAPTER` | Public-ish (just `"mock"`, `"wix"`, or `"identity"`, no secret value) | Controls which login provider is used — independent of `DATA_ADAPTER`; defaults to `"mock"` if unset. See "Development vs. production adapter combinations" below. |
| `PLATFORM_ADMIN_USER_IDS` | Private-ish (user ids, not secrets) | Phase 20 — comma-separated allowlist gating `POST /api/onboarding/start`. Empty/unset means no one can create a new tenant. See `lib/auth/platformAdmin.ts`. |
| `MFA_ENCRYPTION_KEY` | **Private** | Phase 21 — AES-256-GCM key encrypting TOTP secrets at rest (`lib/identity/mfaSecretEncryption.ts`). SHA-256-hashed to exactly 32 bytes; falls back to a fixed, clearly-insecure development value outside production, same pattern as `SESSION_JWT_SECRET`; **throws in production if unset**. Only relevant when `AUTH_ADAPTER=identity`. |

`WIX_API_KEY`/`WIX_SITE_ID` (Phase 12) are unrelated to member login — those authenticate as an *admin*, never as a specific member, and stay reserved for the Phase 12 health check only.

## Development vs. production adapter combinations

`DATA_ADAPTER` and `AUTH_ADAPTER` are independent switches (Phase 15A.1 — see [ADR-011](./adr/ADR-011-auth-data-adapter-separation.md)). All four combinations are valid; the two below are the ones actually expected to be used:

**Development** — real Wix-backed data, without needing a real Wix member account yet:
```
DATA_ADAPTER=wix
AUTH_ADAPTER=mock
```
Reads (organizations today) come from the real Wix project; login still uses the mock credentials (`dana@managedcremations.test` / `mock-password-not-real`). This is the combination Phase 15A's own read integration was verified against.

**Future production** — everything real:
```
DATA_ADAPTER=wix
AUTH_ADAPTER=wix
```
Requires a real Wix Member account to exist and a verified `WIX_OAUTH_CLIENT_ID` (see "Wix dashboard setup" below) — neither exists yet as of this writing.

Mock mode for both (`DATA_ADAPTER=mock`, `AUTH_ADAPTER=mock` — the default when both are unset) and the fourth combination (mock data, real Wix login) are also fully supported; the latter is mainly useful for testing the Wix login flow in isolation before real Wix-backed data reads are needed.

## Wix dashboard setup required (not done — presented for your approval)

Real member login needs exactly one thing in the Wix dashboard: **an OAuth app created under Beacon Development's Headless Settings, giving you a Client ID.** No client secret, no redirect URI, and — critically — **no requirement to publish a companion site**, because this phase deliberately uses the custom-login-page flow (`auth.login()` + `getMemberTokensForDirectLogin()`), not the Wix-hosted-redirect flow. The hosted-redirect flow *does* require a published site to display Wix's own login page; that requirement was the main reason I didn't choose it.

I have not created this OAuth app, and won't without your explicit go-ahead — I only researched what it would take. If you'd like real Wix login to actually work, the ask is: create an OAuth app in Beacon Development's Headless Settings (no other configuration needed for this specific flow), and put its Client ID in `WIX_OAUTH_CLIENT_ID`.

Password recovery (`sendPasswordResetEmail`) is written into `lib/auth/wixAuth.ts`'s design but not wired into any UI this phase — if you want it, it needs a `redirectUri` registered in Beacon Development's allowed authorization redirect URIs, which is a separate, small piece of dashboard setup I'd also present before touching.

## Registration policy

No public registration UI exists, and none was built. Per this phase's own instruction, Beacon defaults to invitation-only / administrator-provisioned access. `lib/auth/wixAuth.ts`'s real-mode module does not even expose a `register()` wrapper — only `login()` — so there's no code path that could create a Wix member account, accidental or otherwise, until a future phase deliberately adds one with your review.

## Mock vs. production identity

Every mock identity's `id` is prefixed `mock-` (e.g. `mock-user-dana`) — a real Wix member `_id` is a GUID, so the two can never be confused by shape. `AuthenticatedUser.source: 'mock' | 'wix'` makes the distinction explicit and checkable in code, not just by convention. `services/__mocks__/authFixtures.ts` is under the existing `__mocks__` directory, matching every other mock fixture file in the codebase.

## Testing

75 tests across 13 files (`npm test`), including 34 new ones covering all 12 required categories:

1. Unauthenticated access → `middleware.test.ts`
2. Authenticated access → `middleware.test.ts`
3. Session restoration → `sessionToken.test.ts`, `session.test.ts`
4. Logout → `session.test.ts`
5. Invalid/expired session → `sessionToken.test.ts`, `middleware.test.ts`
6. Single organization → `authorize.test.ts`
7. Multiple organizations → `authorize.test.ts`
8. Inactive membership rejection → `authorize.test.ts`
9. Cross-organization access → `authorize.test.ts`
10. Browser-supplied unauthorized organizationId → `authorize.test.ts`
11. Mock mode without Wix credentials → `authIntegration.test.ts`
12. No sensitive tokens in client-visible payloads → `authIntegration.test.ts`, `sessionToken.test.ts`

**Live-verified but not part of the committed automated suite:** the full end-to-end browser flow (unauthenticated redirect → mock login → dashboard → case detail → reload → logout → redirect again → wrong-password error) was driven with Playwright during development and confirmed working exactly as designed. This wasn't added as a committed Playwright suite — introducing a new E2E framework wasn't part of this phase's scope, and the equivalent behavior is already covered by the Vitest tests above at the unit level (middleware logic, session logic, authorization logic) plus this manual pass at the integration level.

**Not tested at all:** `lib/auth/wixAuth.ts`'s real Wix login path (`client.auth.login()` → `getMemberTokensForDirectLogin()` → `members.getCurrentMember()`) has never executed against a live Wix API. A `WIX_OAUTH_CLIENT_ID` value now exists locally (see "Known limitations" below), but it was sourced from a downloaded Managed Headless project's `appId`, not confirmed to be a valid self-managed-headless OAuth Client ID — and the Wix MCP tools available to Claude in this session still cannot exercise a live OAuth flow either. It's written and typechecked against `@wix/sdk`'s and `@wix/members`'s own type declarations, the same discipline applied in Phase 12 — verify it yourself once a confirmed OAuth app exists.

## Phase 21 — Identity, Authentication & Session Management

**Status: closed 2026-07-25 (architecture); security corrections closed 2026-07-26.** Full writeup: [ADR-025](./adr/ADR-025-identity-authentication-architecture.md); collection details in [WIX_DATA_SCHEMA.md](./WIX_DATA_SCHEMA.md).

A third `AUTH_ADAPTER` value, `'identity'`, adds Beacon's own email/password identity system alongside the `'mock'`/`'wix'` modes described above (both entirely unchanged by this phase). Highlights:

- **Login:** `app/login/actions.ts`'s `handleIdentityLogin` — email/password, remember-me, progressive lockout after repeated failures (`domain/identity/lockoutPolicy.ts`), and session rotation on every successful login (a fresh `IdentitySession` row + a freshly-signed cookie every time, never a mutated existing one).
- **Session model:** a two-layer design — the existing signed cookie (proves the token was validly issued) plus a new server-side `IdentitySession` registry row (proves the specific session hasn't been revoked, hasn't slid past its own expiration, and was issued under the identity's current password). See `lib/auth/resolveIdentitySession.ts`.
- **Authorization:** `lib/auth/resolveMembershipAuthorizationContext.ts`, the identity-mode sibling of `resolveAuthorizationContext` above, reading a new `Membership` model instead of the mock `OrganizationMembership` fixtures — wired into both `app/(portal)/layout.tsx` and `lib/auth/requireAuthorizedOrganization.ts` (the shared gate every Wix-backed Route Handler already used), so every pre-existing protected route works for identity-mode sessions with no per-route change.
- **Invitations, password reset, email verification, MFA:** `services/invitationService.ts`, `passwordService.ts`, `emailVerificationService.ts`, `mfaService.ts` — see ADR-025 for the key design decisions (invitations as a `Membership` row rather than a new collection; MFA secrets as encrypted values rather than env-var references; hand-rolled TOTP/scrypt rather than new dependencies).
- **Routes:** `POST /api/auth/{forgot-password,reset-password,change-password,verify-email,resend-verification,accept-invitation,switch-organization}`, `GET/DELETE /api/auth/sessions[/{id}]`, `POST /api/auth/sessions/sign-out-everywhere`, `POST/PATCH /api/auth/invitations`, `GET /api/auth/memberships`. Login/logout deliberately stay on the existing Server Action (`app/login/actions.ts`) rather than gaining a redundant REST duplicate — the four public one-shot forms (forgot/reset password, verify email, accept invitation) likewise call `services/*` directly via their own Server Actions rather than fetching this app's own routes.
- **UI:** `/forgot-password`, `/reset-password`, `/verify-email`, `/accept-invitation` (all new, public, added to `middleware.ts`'s allowlist), plus an authenticated `/settings/security` page (Change Password + Manage Sessions + Sign Out Everywhere, consolidated onto one page rather than three separate ones) and an `OrganizationSwitcher` in the top bar for multi-membership identities — both gated on `AUTH_ADAPTER=identity`.
- **Migration:** `services/identityMigrationService.ts`'s `migrateExistingUsers`, run live against `DATA_ADAPTER=wix` — see ADR-025's "Migration" section for the "no forced password resets, no memberships lost" design and the live schema collision it surfaced and resolved.

**Security review corrections (2026-07-26):** three changes made after architecture approval, before this phase's own commit:
1. **`IdentityMessageSender`** (`lib/identity/messageSender.ts`) — a test/dev/production-failing adapter abstraction. Every route that used to return a raw password-reset, email-verification, or invitation token directly in its JSON response now sends it through this abstraction instead; production has no real provider configured, so sending fails loudly (logged server-side) rather than silently, and the client-visible response is always the same generic body regardless of whether the identity existed or the send succeeded.
2. **CSRF protection** (`lib/auth/csrf.ts`'s `requireSameOrigin`) — added as the first check in every cookie-authenticated, state-changing Route Handler across the entire app (not just this phase's own routes), since Next.js's built-in Server Action Origin check does not extend to plain `app/api/*` Route Handlers.
3. **Credential rotation** — a live demo password briefly disclosed during manual verification was rotated immediately; all sessions for that identity were revoked; the disclosed value was confirmed absent from the working tree, `git diff`, and `git log -p --all`.

**Deferred (see ADR-025 for full detail):** the MFA login-time challenge step; transactional email (no provider is wired up anywhere in this codebase — tokens are delivered via `IdentityMessageSender`, not emailed); unifying `StaffProfile` and `Identity` into one directory (**closed in Phase 30** — see below).

## Phase 22 — Role-Based Access Control

**Status: closed 2026-07-27 (architecture); first security-correction round closed 2026-07-28; second security-correction round (lock lease/fencing, provisioning integration) closed 2026-07-29; third security-correction round (write-claim stale-writer rejection) closed 2026-07-30.** Full writeup: [ADR-026](./adr/ADR-026-role-based-authorization-architecture.md); collection details in [WIX_DATA_SCHEMA.md](./WIX_DATA_SCHEMA.md).

Adds a centralized permission model on top of the `Membership`/`OrganizationMembership` role a session already resolves to (both above) — replacing every hardcoded role-name comparison in the codebase with a resolved-permission check, with no change to what any of those checks actually decide.

- **Model:** `Permission` (a `resource.action` key, e.g. `case.read`) → `Role` (a named, ordered set of permissions — platform default or organization-owned custom) → `Membership.role`/`OrganizationMembership.role` (now a plain role key, not a closed enum — see ADR-026's widening discussion). Seven platform-default roles ship seeded: Administrator, Manager, Funeral Director, Arranger, Office Staff, Accounting, Read Only (`domain/rbac/defaultRoles.ts`) — **22 permissions across 10 resources** (`domain/rbac/permissionCatalog.ts`).
- **Resolution:** `services/permissionService.ts`'s `resolveRoleForKey`/`resolvePermissions`/`hasPermission` — always resolved fresh, with **no cross-request cache** (removed in the security-correction round; see below). `services/authorizationPolicyService.ts` is the only layer any Route Handler or business service calls (`canEditCase`, `canCollectPayment`, `canManageOrganization`, `canInviteUser`, `canManageRoles`, ...) — never a role-name comparison.
- **Legacy compatibility:** `domain/rbac/legacyRoleAliases.ts` maps every pre-existing role value (`owner`/`administrator`/`caseManager`/`staff`/`readOnly`) onto the equivalent new default role, so every already-written `Membership`/`OrganizationMembership` row keeps resolving to the exact same permission set it always implied — no data migration needed, confirmed by the full pre-existing test suite passing unchanged.
- **Custom roles:** `services/roleService.ts`'s `createCustomRole`/`cloneRole`/`updateRole`/`deleteRole` — an organization may clone a default role (or another of its own custom roles) into a new, independently renamable and re-permission-able role; platform defaults themselves are immutable (`updateRole`/`deleteRole` refuse to act on one). `assignRole`/`removeRole`/`updateRole`/`deleteRole`/`setMembershipStatus` all refuse — under a durable, per-organization lock — any change that would leave an organization with zero administrator-tier (`organization.manage`) members.
- **Routes:** `GET /api/rbac/permissions` (the full catalog), `GET/POST /api/rbac/roles`, `PATCH/DELETE /api/rbac/roles/[roleId]`, `POST /api/rbac/roles/[roleId]/clone`, `GET /api/rbac/members`, `GET /api/rbac/my-permissions`, `POST/DELETE /api/rbac/assignments` — every state-changing one CSRF-protected identically to `/api/auth/*` (`requireSameOrigin` as the first check), and gated by `requireIdentitySession` — this route surface, like `/api/auth/*`, exists only for `AUTH_ADAPTER='identity'` sessions.
- **UI:** an Organization Roles Page (`/settings/roles`) — role list, a Role Editor with an interactive Permission Matrix, an Assign Role Dialog, and a Permission Inspector showing the current session's own resolved permissions — linked from the top bar alongside "Security" for identity-mode sessions.
- **Migration of existing comparisons:** `lib/auth/authorize.ts`'s `hasAdminTierMembership`, `services/organizationProvisioningService.ts`'s `countAdminMemberships`, and `app/api/auth/invitations/route.ts`'s invite gate all now resolve through `authorizationPolicyService.isAdminTier`/`canInviteUser` instead of comparing role names directly. See ADR-026 for the full migration list and why `assignInitialAdministrator`'s fixed `'administrator'` write was deliberately left alone (an assignment, not a comparison).

**Security-correction round (2026-07-27/28):** five corrections made after architecture approval, before this phase's final acceptance — full detail in ADR-026's own "Security-correction round" section:
1. **Concurrency-safe last-administrator invariant** — a durable per-organization lock (`services/organizationLockService.ts`, backed by a new `organizationRoleLocks` collection) plus a single unified admin-count check, run inside that lock by every mutation that can affect who counts as an administrator (including the newly-added `setMembershipStatus` guard for disabling/removing a member).
2. **Removed the cross-request permission cache entirely** — it was only ever correct for a single application instance; every resolution now reads fresh, every call.
3. **Durable, concurrency-safe seeding** — deterministic ids (`domain/rbac/deterministicIds.ts`) with insert-then-treat-conflict-as-success semantics, replacing the original query-then-insert pattern.
4. **Fail-closed behavior confirmed by test** for missing/foreign/malformed roles, and one real gap closed: removing an admin-tier permission from an *assigned* custom role is now checked against the same invariant.
5. **Permission/resource count corrected**: 22 permissions, 10 resources (a report had said 8).

**Second security-correction round (2026-07-29):** two further corrections, full detail in ADR-026's own "Second security-correction round" section:
1. **The lock became a renewable lease with ownership-token validation and a monotonic fencing token.** The first round's flat 10-second TTL permitted a second owner to reclaim the lock while the original owner might still be executing (a realistic risk under Wix Data rate limiting, which this project hit live). Now: a background heartbeat renews the lease every 3 seconds; every one of `RoleService`'s five guarded mutations calls `assertFenceStillCurrent` immediately before its actual write; a lost lease fails the *whole* operation closed even if the wrapped logic "succeeded"; stale-lock recovery after a crashed process is unchanged (a lease that stops renewing simply lapses).
2. **RBAC seeding is now wired into organization provisioning.** `services/organizationProvisioningService.ts`'s `startOnboarding`/`assignInitialAdministrator`/`completeOnboarding`/`migrateExistingOrganization` all now seed/verify the organization's RBAC roster automatically and idempotently — a newly provisioned tenant (or one migrated through the legacy backfill path) receives its default-role roster without any manual step, closing the gap where only Manor's Cremation (seeded by hand during Phase 22's own live verification) had one.

**Third security-correction round (2026-07-30):** one further correction, full detail in ADR-026's own "Third security-correction round" section. The second round's fencing check (`assertFenceStillCurrent` called immediately before a write) was still not sufficient — the check and the write it guards are two separate operations, and a lease can be reclaimed in the gap between them; detecting the loss afterward does not undo a write that already landed. Empirically confirmed first (a live throwaway script, deleted after use): Wix Data's `items` API has **no revision/optimistic-concurrency support of any kind** — a stale value in an update request body is silently ignored and the write unconditionally applies. Given that, the strongest achievable mitigation was built from the one atomic primitive Wix Data actually offers (unique-id insert-conflict): a second, shorter-lived **write claim** (new `organizationRoleWriteClaims` collection) that a protected write takes immediately before its persistence calls, and which the lease's own stale-reclaim path now checks — a lease cannot be reclaimed while a live claim exists, closing the race for the overwhelming majority of its surface area. All five of `RoleService`'s guarded mutations now route their writes through `commitProtectedWrite` rather than a bare fencing check. **Honestly documented, not claimed away:** one gap remains — between the final fencing check and the write's actual dispatch — which no client-side check can close without Wix Data itself supporting a conditional write; closing it completely would require a full event-sourced rewrite of `Membership`/`Role` persistence, not undertaken this phase.

**Deferred (see ADR-026 for full detail):** disabling one of an organization's seven default-role enablements; anything beyond a flat checkbox permission-editing UI for custom roles. ("A route/UI for 'remove a member from the organization'" — closed by Phase 23, below.)

## Phase 23 — Team Management

**Status: backend prerequisites closed 2026-07-30.** Full writeup: [ADR-027](./adr/ADR-027-team-management.md).

Three small, additive backend gaps closed before building a staff-management UI on top of Phase 21–22's already-complete identity/membership/RBAC backend — not a re-architecture:

- **`GET`/`DELETE /api/auth/invitations`** — lists pending invitations and revokes one, gated by the existing `canInviteUser` (`user.invite`). Revoke is idempotent, refuses to touch an already-accepted invitation (409), and invalidates the invitee's live token.
- **`PATCH /api/rbac/membership-status`** (new route) — exposes `RoleService.setMembershipStatus` (disable/reactivate/remove), gated by the existing (previously unused) `canRemoveUser` (`user.remove`). Fixed two real gaps: reactivation now writes an audit entry (previously wrote none); `'removed'` is now explicitly terminal (previously nothing prevented reactivating a removed membership). A caller may never target their own membership through this route.
- `OrganizationRoleAuditAction` gained four values (`invitation_revoked`, `membership_disabled`, `membership_reactivated`, `membership_removed`) — no Wix schema change, confirmed live (`organizationRoleAuditEntries.action` is `TEXT`).

## Phase 24 — Case Activity Timeline & Audit Center

**Status: closed 2026-07-28.** Full writeup: [ADR-028](./adr/ADR-028-activity-timeline-and-audit-center.md); collection details in [WIX_DATA_SCHEMA.md](./WIX_DATA_SCHEMA.md).

Two new permission keys, `audit.read` and `audit.export` (`domain/rbac/permissionCatalog.ts`), widening the catalog from 22 to **24 permissions across 10 resources** — no new resource category, since both keys belong to the existing `audit` scope alongside every other resource-shaped permission.

- **`audit.read`** — view the organization-wide Audit Center. Granted to Administrator, Manager, Funeral Director, Accounting, Read Only (mirrors `report.view`'s distribution).
- **`audit.export`** — export audit data as CSV. Granted to Administrator, Manager, Accounting only (narrower — mirrors `payment.refund`'s distribution).
- **No separate `audit.case.read`.** The Case Activity tab's route (`GET /api/cases/[caseId]/activity`) is gated the same way every other case route already is — `requireAuthorizedOrganization`'s active-membership check — not a new permission. Case routes were never migrated to per-permission RBAC checks in any prior phase (Phase 22 included), so inventing one only for the activity sub-resource would be a new, inconsistent gate rather than reuse of an existing one.
- `services/authorizationPolicyService.ts` gained `canReadAuditLog`/`canExportAuditLog`, each a one-line `hasPermission` wrapper, matching every other policy function's shape.

## Phase 25 — Document Generation & Template Management

**Status: closed 2026-08-05.** Full writeup: [ADR-029](./adr/ADR-029-document-generation-and-template-management.md); collection details in [WIX_DATA_SCHEMA.md](./WIX_DATA_SCHEMA.md).

Six permission keys total, two already existing but dead until now and four new, widening the catalog from 24 to **28 permissions**:

- **`document.view`** and **`document.generate`** — declared in Phase 22 ahead of any real feature to gate; this phase finally wires both to real case-document routes. Granted to every role except Accounting (unchanged tier from Phase 22).
- **`document.upload`** — new. Mirrors `document.view`'s tier (every role except Accounting) with one deliberate exception: **Read Only does not get it**, despite otherwise matching that tier — uploading is a write action, and Read Only is the one role whose entire permission list was, until now, exclusively read/view actions; granting it upload would be the first write action that role ever held.
- **`document.archive`** — new, narrower. Granted to Administrator, Manager, Funeral Director only (mirrors `payment.refund`'s tier).
- **`document.template.read`** — new. View the organization-wide Document Template Library. Granted to Administrator, Manager, Funeral Director (mirrors `workflow.read`'s tier).
- **`document.template.manage`** — new, narrower. Create/edit/duplicate/archive templates. Granted to Administrator, Manager only (mirrors `workflow.publish`'s tier).
- **Case-scoped document routes gate on a real, intentional permission** (`document.view`/`document.generate`/`document.upload`/`document.archive`) — unlike Phase 24's Case Activity tab, which reuses `requireAuthorizedOrganization` alone. This is not an inconsistency: `document.view`/`document.generate` already existed as keys distinct from `case.read` before this phase, so reusing them is wiring up a pre-existing, deliberate gate rather than inventing a new one with no real distinction.
- `services/authorizationPolicyService.ts` gained `canViewDocument`/`canUploadDocument`/`canArchiveDocument`/`canReadDocumentTemplate`/`canManageDocumentTemplate`, each a one-line `hasPermission` wrapper (`canGenerateDocument` already existed, dead, since Phase 22).

## Phase 26 — Electronic Signatures & Authorization Workflows

**Status: closed 2026-08-14.** Full writeup: [ADR-030](./adr/ADR-030-electronic-signatures-and-authorization-workflows.md); collection details in [WIX_DATA_SCHEMA.md](./WIX_DATA_SCHEMA.md).

Four new permission keys, widening the catalog from 28 to **32 permissions**:

- **`signature.request`** — create/resend a signature request on a case document. Mirrors `document.generate`'s tier (every role except Accounting).
- **`signature.read`** — view signature status/history. Mirrors `document.view`'s tier (every role except Accounting).
- **`signature.cancel`** — cancel an active signature request. Mirrors `document.archive`'s narrower tier (Administrator, Manager, Funeral Director only).
- **`signature.manage`** — reserved for a future org-wide signature settings surface; no dedicated UI ships this phase. Mirrors `document.template.manage`'s tier (Administrator, Manager only).
- `services/authorizationPolicyService.ts` gained `canRequestSignature`/`canReadSignature`/`canCancelSignature`/`canManageSignature`, each a one-line `hasPermission` wrapper.
- `seedPlatformDefaultRoles` was re-run against live Wix so organizations already provisioned before this phase picked up the four new keys (same live-data corollary Phase 25 documented for its own four new keys).

**A genuinely new authorization pattern: the sessionless public signing surface.** Every prior public/token-gated route in this codebase (`verify-email`, `reset-password`, `accept-invitation`) eventually mints a Beacon session for the person using it. `/sign` and `/api/signing/*` never do, for anyone, ever — a signer has no Beacon account at all. Authorization for these routes reduces entirely to "do you possess a valid, hashed, not-yet-terminal, not-yet-expired token" (the exact same trust model a password-reset link already relies on), with the signer's identity verified out-of-band — the staff member emailed *this specific* signer at *this specific* address — rather than by any Beacon credential. `middleware.ts`'s matcher allowlists `/sign` alongside the four existing public identity pages (`/api/*` was already excluded wholesale). No RBAC permission ever gates a public signing route; RBAC governs only the four staff-facing signature routes above.

## Phase 27 — Scheduling & Resource Management

**Status: closed 2026-08-03.** Full writeup: [ADR-031](./adr/ADR-031-scheduling-and-resource-management.md); collection details in [WIX_DATA_SCHEMA.md](./WIX_DATA_SCHEMA.md).

Six new permission keys, widening the catalog from 32 to **38 permissions**:

- **`schedule.read`** — view calendars/appointments. Mirrors `document.view`'s tier (every role except Accounting).
- **`schedule.create`** — create a new appointment. Mirrors `document.generate`/`signature.request`'s tier (every role except Accounting).
- **`schedule.edit`** — reschedule/update/confirm/complete an appointment. Same tier as `schedule.create`.
- **`schedule.cancel`** — cancel an appointment. Mirrors `document.archive`/`signature.cancel`'s narrower tier (Administrator, Manager, Funeral Director only).
- **`resource.manage`** — create/edit/change-lifecycle-status of resources; authorize a hard-conflict override. Mirrors `document.template.manage`/`signature.manage`'s tier (Administrator, Manager only).
- **`calendar.manage`** — reserved for a future org-wide calendar settings surface; no dedicated UI ships this phase. Same tier as `resource.manage`.
- `services/authorizationPolicyService.ts` gained `canReadSchedule`/`canCreateAppointment`/`canEditAppointment`/`canCancelAppointment`/`canManageResources`/`canManageCalendar`, each a one-line `hasPermission` wrapper.
- `seedPlatformDefaultRoles` was re-run against live Wix so organizations already provisioned before this phase picked up the six new keys (same live-data corollary Phases 25/26 documented for their own new keys).

**Staff are authorized exactly as they already were — scheduling introduces no second identity system.** A `Resource` row with `resourceType: 'staff'`/`'funeral_director'` carries `linkedMembershipId` purely as a display/assignment convenience; every permission check for scheduling actions still resolves through the caller's real `Membership` via `requireAuthorizedOrganization`/`AuthorizationPolicyService`, exactly like every other route in this codebase. No route ever checks a `Resource` row's own fields to decide what its linked staff member is allowed to do.

## Phase 28 — Communications & Notifications

**Status: closed 2026-08-04.** Full writeup: [ADR-032](./adr/ADR-032-communications-and-notifications.md); collection details in [WIX_DATA_SCHEMA.md](./WIX_DATA_SCHEMA.md).

Four new permission keys, widening the catalog from 38 to **42 permissions**:

- **`notification.read`** — view the organization-wide notification log. Mirrors `audit.read`'s own broader tier (Administrator, Manager, Funeral Director, Accounting, Read Only).
- **`notification.send`** — create/broadcast a manual notification. Mirrors `document.generate`/`schedule.create`'s tier (every role except Accounting, Read Only).
- **`notification.manage`** — cancel a pending notification; manage notification settings. Mirrors `document.template.manage`/`signature.manage`'s narrower tier (Administrator, Manager only).
- **`notification.admin`** — reserved for a future org-wide notification policy surface; no dedicated UI ships this phase. Same tier as `notification.manage`.
- `services/authorizationPolicyService.ts` gained `canReadNotifications`/`canSendNotification`/`canManageNotifications`/`canAdminNotifications`, each a one-line `hasPermission` wrapper.
- `seedPlatformDefaultRoles` was re-run against live Wix so organizations already provisioned before this phase picked up the four new keys — hit the same `HTTP 429` rate-limit Phase 27's own closeout found re-running the full seed, resolved via the identical targeted, quota-efficient fix (query existing grants, insert only what's genuinely missing).

**The personal inbox needs no permission at all.** Viewing one's own notifications, unread count, mark-read/archive, and one's own preferences are scoped entirely by the caller's own identity (`requireAuthorizedOrganization`'s resolved `userId`, never a client-supplied identity) — no `canX` check gates any of them, by explicit design (a user always has authority over their own inbox).

**`case_participants` is a real `RecipientScope` value with no working implementation this phase.** `Case.assignedStaffId`/`intakeOwnerId` reference `StaffProfile.id` — the same pre-Identity-model, mock-only concept this document's Phase 21 section above already names as deferred ("unifying `StaffProfile` and `Identity` into one directory") — not a real `Identity.id`/`Membership.id`. `services/notifications/recipientResolver.ts` throws a clear, typed error for this scope rather than inventing a bridge. The identical gap also blocked a real `SchedulingNotifier` implementation and task-assignment notifications this phase; all three are deferred together — see ADR-032. **`case_participants` and task-assignment notifications were built in Phase 30** (see below); `SchedulingNotifier` concrete delivery remains a distinct, still-reserved mechanism.

## Phase 29 — Family Portal & External Collaboration

**Status: closed 2026-08-05.** Full writeup: [ADR-033](./adr/ADR-033-family-portal-and-external-collaboration.md); collection details in [WIX_DATA_SCHEMA.md](./WIX_DATA_SCHEMA.md).

A second, fully independent authentication system, deliberately never composed with anything above this section:

- **`PortalUser`** (`portalUsers` collection) is a physically separate identity population from `Identity` — never the `identities` collection, never a `Membership`, never reachable through any staff RBAC/organization-switching code path. A person cannot exist simultaneously as an `Identity` and a `PortalUser` from the same account.
- **Cookie:** `beacon_family_session` (constant: `lib/auth/familySessionToken.ts`'s `FAMILY_SESSION_COOKIE_NAME`) — never `beacon_session`. **Signing:** HMAC-SHA256 over Web Crypto, same mechanism as the staff `sessionToken.ts`, but with a structurally distinct signing key — derived via an HKDF-style "expand" step (`HMAC(SESSION_JWT_SECRET, 'beacon-family-portal-session-v1')`) off the same root secret, so no new required env var is needed while the two keys are never byte-identical. The signed payload carries an explicit `aud: 'family'` audience claim. `lib/auth/sessionIsolation.test.ts` proves cross-rejection: a staff token is never accepted by the family verifier and vice versa.
- **Resolution chain:** `beacon_family_session` → `requireFamilySession` (mirrors `requireIdentitySession.ts`) → `PortalSession` (live revocation/expiry check) → `requireFamilyAccess` looks up the `PortalAccess` row by `(portalUserId, caseId)` — **never** by a client-supplied `organizationId` — requires `status === 'active'` (fail closed otherwise), reads `organizationId` back off that row, then checks one `PortalCapabilityKey` via `hasPortalCapability`. Only then is the underlying service called.
- **`middleware.ts`** gates `/family/*` in a structurally separate branch from the staff branch — it never parses the family cookie for a staff-side path, and never parses the staff cookie for a `/family/*` path. A missing/invalid family session redirects to `/family/login` (never `/login`), with `/family/login`, `/family/accept-invitation`, `/family/forgot-password`, `/family/reset-password` carved out as public.
- **Rate limiting**, new this phase: `lib/rateLimiter.ts`, an in-memory, fixed-window, per-key bounded counter — explicitly process-local (no shared-state store exists in this codebase, same disclosed gap as staff login below), applied to family login, invitation acceptance, message-send, and payment-checkout-initiation.
- **Existence-hiding** on every credential-adjacent family route (accept-invitation, login, forgot-password, reset-password) — a lookup failure, an expired token, and a wrong credential are never distinguished in the response.
- Two new staff RBAC permissions, widening the catalog from 42 to **44**: `portal.manage` (Administrator, Manager tier — invite/revoke family access, toggle document family-visibility) and `portal.message` (every role except Accounting, Read Only).
- **One person holding both a staff `Membership` and a `PortalAccess` simultaneously is not supported this phase** — the same class of limitation already accepted for Wix Member vs. mock login above.

## Phase 30 — Identity Model Hardening & Staff Assignment Architecture

**Status: closed 2026-08-06.** Full writeup: [ADR-034](./adr/ADR-034-identity-model-hardening-and-staff-assignment-architecture.md); collection details in [WIX_DATA_SCHEMA.md](./WIX_DATA_SCHEMA.md).

Closes the `StaffProfile`/`Identity` gap this document's Phase 21 and Phase 28 sections both name above. `StaffProfile` gained `identityId` (required — the canonical authenticated-identity id space, already normalized across every `AUTH_ADAPTER` mode) and `membershipId` (nullable — set only when a real `Membership` exists). The canonical chain is now `Identity` → `Membership` → `StaffProfile` → operational assignments, with a **hard layering invariant**: no operational-assignment field (`Case.assignedStaffId`/`intakeOwnerId`/`createdBy`, `CaseTask.assigneeStaffId`, new `Appointment.ownerStaffProfileId`, new `Resource.linkedStaffProfileId`) is ever allowed to reference `Identity.id` directly, only `StaffProfile.id` — orthogonal to, and never changing, the pre-existing actor-attribution fields (`Appointment.createdBy`/`lastModifiedBy`/`cancelledBy`, etc.) that correctly stay `Identity.id`-space.

`services/staffProfileService.ts` (replacing `services/staffService.ts`) is the sole owner of the new `staffProfiles` collection, exposing `resolveStaffProfileForCaller` (the real replacement for `hooks/useSession.ts`'s pre-Phase-30 hardcoded stub) and two validation functions: `assertStaffProfileIsActiveAndInOrganization` (existence/active/org-match only, no permission check — for code paths with no real RBAC actor, e.g. the mock branches of `casesService.ts`/`tasksService.ts`) and `assertAssignableStaffProfile` (the same, plus an RBAC permission check parameterized by permission key — `case.update`/`schedule.edit`/the new `task.assign` — never one shared permission). One new RBAC key, widening the catalog from 44 to **45**: `task.assign`, tiered like `schedule.edit` (every default role except Accounting, Read Only).

A two-phase, dry-run-then-apply migration (`services/staffProfileMigrationService.ts`) backfilled a real `StaffProfile` row for Manor's Cremation's staff, resolving each by known email correspondence against a real `Identity` — **never inventing one**. Live-run result: `staff-dana` resolved and was created (a real identity from Phase 21's own migration); `staff-chris`/`staff-priya` (mock-fixture-only additions this phase) correctly reported unresolved — a named, open gap that closes automatically the next time this migration runs, once those two people are actually invited through the real invitation flow.

**`PortalUser` boundary reaffirmed**: `resolveStaffProfileForCaller`/`assertAssignableStaffProfile` are never called from any `/api/family/*` route — `lib/auth/sessionIsolation.test.ts` now asserts this structurally too, alongside its existing staff/family session-isolation checks.

## Phase 31 — Financial Management & General Ledger

**Status: closed 2026-08-10.** Full writeup: [ADR-035](./adr/ADR-035-financial-management-and-general-ledger.md); collection details in [WIX_DATA_SCHEMA.md](./WIX_DATA_SCHEMA.md).

Five new RBAC keys — `accounting.view`, `accounting.manage`, `accounting.post`, `accounting.reconcile`, `accounting.report` — widen the catalog from 45 to **50**. This is a deliberate, documented deviation from every other domain's fine-grained `<entity>.<verb>` convention: one coarse resource prefix covering the whole accounting subsystem, honoring the phase's own spec exactly rather than splitting into ~15 keys. `administrator` and the existing `accounting` role (whose entire reason for existing is this phase) get all 5; every other default role (`manager`, `funeralDirector`, `arranger`, `officeStaff`, `readOnly`) gets none by default.

A live `rolePermissions` re-seed was required for these 5 keys against `administrator`/`accounting` (10 grant rows), following the same targeted, quota-efficient pattern Phase 27/28/30 already established — **a full `seedPlatformDefaultRoles` re-run hits the documented `HTTP 429` rate limit; any phase adding a permission key to an existing role's tier must insert only the specific missing grant rows, this is not automatic.**

**`accountingClient.ts`/`useAccounting.ts` follow the identical client/server module-naming and permission-gating conventions** every prior phase's UI established (`useMyPermissions(organizationId)`, `EmptyState` on denial, conditional mutating controls) — no new authorization pattern was introduced.

## Known limitations

- **Organization membership has no real data source — for `AUTH_ADAPTER='mock'|'wix'` sessions specifically.** `resolveAuthorizationContext` still reads the same mock fixtures mock mode always has — this remains entirely true for those two modes and is unchanged by any later phase. **(Phase 21 note:** `AUTH_ADAPTER='identity'` sessions *do* now have a real data source — `services/membershipService.ts`'s `Membership` model, backed by the live `organizationMemberships` collection's Phase 21 fields. A real Wix member logging in via `'wix'` mode still has no membership record invented for them; this gap is only closed for the new identity system, not for Wix Member login.)
- **No token persistence for real Wix members.** `loginWithWix` discards the Wix access/refresh tokens immediately after resolving identity. This means a real member's Beacon session proves who they are but grants no ability for Beacon to call further Wix APIs on their behalf — by design for this phase (no service calls Wix on a user's behalf yet either), but a real gap for whenever that changes.
- **No organization-switcher UI — for `AUTH_ADAPTER='mock'|'wix'` sessions specifically.** `resolveAuthorizationContext`'s `selection_required` case remains a real, tested code path with no UI consumer for these two modes — a user with multiple memberships is still sent back to login with a message telling them to contact an administrator. **(Phase 21 note:** `AUTH_ADAPTER='identity'` now has a real switcher — `components/layout/OrganizationSwitcher.tsx`, backed by `GET /api/auth/memberships` and `POST /api/auth/switch-organization`.)
- **Password reset, email verification, and CAPTCHA states** in `lib/auth/wixAuth.ts` are recognized and returned as distinct failure reasons, but none has dedicated UI — they all currently render as a generic message on the login page.
- **Rate limiting is not implemented for staff login.** No attempt-throttling exists for either the mock or Wix login paths. Noting this explicitly rather than silently omitting it: a production deployment needs this before real credentials are at stake — likely at the infrastructure layer (e.g., Vercel/WAF-level rate limiting) or a small in-app counter keyed by IP/email, neither of which was built this phase. **(Phase 29 note:** the Family Portal login/invitation-acceptance/messaging/checkout surface now has exactly this kind of in-app counter — `lib/rateLimiter.ts` — but it is explicitly process-local, not a shared-state store; this gap remains fully open for staff login specifically.)
- ~~**API routes do not verify `organizationId` against the caller's session.**~~ **Closed in Phase 15X** (2026-07-23). Every Wix-backed Route Handler (`organizations`, `workflow-templates` ×2, `cases` ×2, `tasks`) now calls `lib/auth/requireAuthorizedOrganization.ts` before using a client-supplied `organizationId` for anything — see `docs/ROADMAP.md`'s "Completed: Multi-Tenant Authorization Hardening" and [ADR-015](./adr/ADR-015-multi-tenant-authorization-hardening.md).
- **Wix Goal 1 (verify the connected account/Beacon Development project) is now confirmed** — not via the Wix MCP tools, which remain undiscoverable in every session to date, but via a live run of Phase 12's `GET /api/wix-health` against the real project on 2026-07-21, which returned `HTTP 200` and `siteDisplayName: "Beacon Development"`. This confirms server-to-Wix connectivity and that `WIX_SITE_ID` is correct. **It does not confirm OAuth member login** — `WIX_OAUTH_CLIENT_ID` (sourced from the Managed Headless project's own `appId`, not a dedicated self-managed-headless OAuth app) remains completely unexercised, and `loginWithWix`'s real-mode path has still never executed against a live Wix API. See `docs/WIX_INTEGRATION.md`'s "The health check" section for the full result.
- **Phase 31: financial reports have no scheduled-recompute/snapshot path — they re-scan all-time journal history on every request.** Architecturally clean (zero concurrent-write corruption risk, since nothing is cached) but a real, named future scaling cost as ledger history grows; a period-snapshot mitigation is deferred until a formal period-close feature exists.
- **Phase 31: `INVOICE_OVERDUE` has no true scheduled trigger.** Beacon has no background/cron job infrastructure anywhere in the codebase; this notification type can only be evaluated on-demand (e.g., when a staff member views the AR Aging report), never on a real nightly schedule. Same class of gap as `SchedulingNotifier`'s reserved concrete-delivery mechanism — named, not silently worked around.
