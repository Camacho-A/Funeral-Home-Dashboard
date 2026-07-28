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

**Deferred (see ADR-025 for full detail):** the MFA login-time challenge step; transactional email (no provider is wired up anywhere in this codebase — tokens are delivered via `IdentityMessageSender`, not emailed); unifying `StaffProfile` and `Identity` into one directory.

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

## Known limitations

- **Organization membership has no real data source — for `AUTH_ADAPTER='mock'|'wix'` sessions specifically.** `resolveAuthorizationContext` still reads the same mock fixtures mock mode always has — this remains entirely true for those two modes and is unchanged by any later phase. **(Phase 21 note:** `AUTH_ADAPTER='identity'` sessions *do* now have a real data source — `services/membershipService.ts`'s `Membership` model, backed by the live `organizationMemberships` collection's Phase 21 fields. A real Wix member logging in via `'wix'` mode still has no membership record invented for them; this gap is only closed for the new identity system, not for Wix Member login.)
- **No token persistence for real Wix members.** `loginWithWix` discards the Wix access/refresh tokens immediately after resolving identity. This means a real member's Beacon session proves who they are but grants no ability for Beacon to call further Wix APIs on their behalf — by design for this phase (no service calls Wix on a user's behalf yet either), but a real gap for whenever that changes.
- **No organization-switcher UI — for `AUTH_ADAPTER='mock'|'wix'` sessions specifically.** `resolveAuthorizationContext`'s `selection_required` case remains a real, tested code path with no UI consumer for these two modes — a user with multiple memberships is still sent back to login with a message telling them to contact an administrator. **(Phase 21 note:** `AUTH_ADAPTER='identity'` now has a real switcher — `components/layout/OrganizationSwitcher.tsx`, backed by `GET /api/auth/memberships` and `POST /api/auth/switch-organization`.)
- **Password reset, email verification, and CAPTCHA states** in `lib/auth/wixAuth.ts` are recognized and returned as distinct failure reasons, but none has dedicated UI — they all currently render as a generic message on the login page.
- **Rate limiting is not implemented.** No attempt-throttling exists for either the mock or Wix login paths. Noting this explicitly rather than silently omitting it: a production deployment needs this before real credentials are at stake — likely at the infrastructure layer (e.g., Vercel/WAF-level rate limiting) or a small in-app counter keyed by IP/email, neither of which was built this phase.
- ~~**API routes do not verify `organizationId` against the caller's session.**~~ **Closed in Phase 15X** (2026-07-23). Every Wix-backed Route Handler (`organizations`, `workflow-templates` ×2, `cases` ×2, `tasks`) now calls `lib/auth/requireAuthorizedOrganization.ts` before using a client-supplied `organizationId` for anything — see `docs/ROADMAP.md`'s "Completed: Multi-Tenant Authorization Hardening" and [ADR-015](./adr/ADR-015-multi-tenant-authorization-hardening.md).
- **Wix Goal 1 (verify the connected account/Beacon Development project) is now confirmed** — not via the Wix MCP tools, which remain undiscoverable in every session to date, but via a live run of Phase 12's `GET /api/wix-health` against the real project on 2026-07-21, which returned `HTTP 200` and `siteDisplayName: "Beacon Development"`. This confirms server-to-Wix connectivity and that `WIX_SITE_ID` is correct. **It does not confirm OAuth member login** — `WIX_OAUTH_CLIENT_ID` (sourced from the Managed Headless project's own `appId`, not a dedicated self-managed-headless OAuth app) remains completely unexercised, and `loginWithWix`'s real-mode path has still never executed against a live Wix API. See `docs/WIX_INTEGRATION.md`'s "The health check" section for the full result.
