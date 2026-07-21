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
  branches on DATA_ADAPTER)

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

**What "membership data" means today:** there is no Wix data collection for organization memberships (creating one is out of this phase's scope), so `resolveAuthorizationContext` reads `services/__mocks__/authFixtures.ts` regardless of `DATA_ADAPTER`. A real Wix member can log in for real (if `DATA_ADAPTER=wix` and an OAuth app exists — see below), but their organization access is *not yet* resolved from anything Wix-hosted; see "Known limitations."

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
| `WIX_OAUTH_CLIENT_ID` | Private-ish (a client ID, not a secret by Wix's own design — headless member OAuth needs no client secret) | Required only when `DATA_ADAPTER=wix` and a real login attempt happens |

`WIX_API_KEY`/`WIX_SITE_ID` (Phase 12) are unrelated to member login — those authenticate as an *admin*, never as a specific member, and stay reserved for the Phase 12 health check only.

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

**Not tested at all:** `lib/auth/wixAuth.ts`'s real Wix login path (`client.auth.login()` → `getMemberTokensForDirectLogin()` → `members.getCurrentMember()`) has never executed against a live Wix API. No real `WIX_OAUTH_CLIENT_ID` exists, and the Wix MCP tools available to Claude in this session cannot exercise a live OAuth flow either (see the phase report's "Known limitations"). It's written and typechecked against `@wix/sdk`'s and `@wix/members`'s own type declarations, the same discipline applied in Phase 12 — verify it yourself once a real OAuth app exists.

## Known limitations

- **Organization membership has no real data source.** Even in `DATA_ADAPTER=wix` mode, `resolveAuthorizationContext` reads the same mock fixtures mock mode does — there's no Wix (or other) collection for memberships yet. A real Wix member who successfully logs in today would still need a membership record invented for them somehow before they could access any organization; this phase doesn't solve that.
- **No token persistence for real Wix members.** `loginWithWix` discards the Wix access/refresh tokens immediately after resolving identity. This means a real member's Beacon session proves who they are but grants no ability for Beacon to call further Wix APIs on their behalf — by design for this phase (no service calls Wix on a user's behalf yet either), but a real gap for whenever that changes.
- **No organization-switcher UI.** `resolveAuthorizationContext`'s `selection_required` case is a real, tested code path with no UI consumer — a user with multiple memberships is currently sent back to login with a message telling them to contact an administrator, not offered a picker.
- **Password reset, email verification, and CAPTCHA states** in `lib/auth/wixAuth.ts` are recognized and returned as distinct failure reasons, but none has dedicated UI — they all currently render as a generic message on the login page.
- **Rate limiting is not implemented.** No attempt-throttling exists for either the mock or Wix login paths. Noting this explicitly rather than silently omitting it: a production deployment needs this before real credentials are at stake — likely at the infrastructure layer (e.g., Vercel/WAF-level rate limiting) or a small in-app counter keyed by IP/email, neither of which was built this phase.
- **Wix Goal 1 (verify the connected account/Beacon Development project) remains unconfirmed by Claude directly** — the Wix MCP tools are still undiscoverable in this session (see the phase report).
