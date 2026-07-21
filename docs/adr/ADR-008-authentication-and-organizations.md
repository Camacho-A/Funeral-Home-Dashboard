# ADR-008: Authentication & Organizations

**Status:** Accepted
**Date:** 2026-07-21

## Context

Through Phase 12, Beacon has no authentication at all — every portal route is reachable by anyone, and `organizationId` is supplied by a React Context (`useOrganization()`) seeded from a hardcoded constant, never validated against any real access grant. Phase 11 built organization-scoped domain architecture (workflow templates, per-organization data), and Phase 12 built a server-side Wix connectivity foundation, but neither addressed *who* is using the app or *which organizations they're actually allowed to touch*. Before any real, multi-organization deployment is possible, both need real answers — and per this phase's own constraints, without migrating case data to Wix, without building a full admin console, and without silently trusting whatever `organizationId` a browser happens to send.

## Decision

Add a session/authorization layer that is entirely independent of *how* a user authenticated: `lib/auth/sessionToken.ts` issues a signed (HMAC-SHA256, Web Crypto), httpOnly-cookie-backed session (`lib/auth/session.ts`) regardless of whether the identity behind it came from `lib/auth/mockAuth.ts` (mock mode) or `lib/auth/wixAuth.ts` (real Wix member login). Route protection (`middleware.ts`) checks only for a valid session — never for *which* provider issued it.

Organization access is resolved, not trusted: `lib/auth/authorize.ts`'s `resolveAuthorizationContext` is the only function permitted to produce an `AuthorizationContext` (`types/authorization.ts`), and it always starts from the session's own `userId`, looking up that user's actual membership rows before ever returning an organizationId. A browser-supplied organizationId is only ever treated as a *candidate to check*, never as truth — `app/(portal)/layout.tsx` calls this on every request (session already re-verified there too, independent of middleware) and feeds only its validated result into `OrganizationProvider`, which every existing page and service already consumes unchanged.

For the real Wix login path, the custom-login-page flow (`auth.login()` + `getMemberTokensForDirectLogin()` + `members.getCurrentMember()`) was chosen over Wix's hosted-redirect login page specifically because it requires no published companion site — only an OAuth app (Client ID) in Beacon Development's Headless Settings, a small, reversible dashboard change presented for approval rather than made.

## Consequences

- Every existing page/component/service is unaffected in shape: `useOrganization()` still returns `{ organizationId: string }`; no service signature changed. Only *where that value comes from* changed — from a hardcoded constant to a validated, session-derived lookup.
- Cross-organization access, inactive-membership access, and browser-forged organizationId claims are all rejected by the same one function, and all three are directly, automatedly tested (`lib/auth/authorize.test.ts`) rather than assumed to work from code review alone.
- Mock mode requires zero new configuration to keep working — `SESSION_JWT_SECRET` (a name reserved since Phase 0) falls back to a fixed, clearly-insecure development value outside production, so `npm run dev`/`test`/`build` in mock mode need nothing new set.
- Real Wix member login is implemented and typechecked but genuinely unverified against a live project — no OAuth app exists yet (a decision left to you), and organization membership itself has no Wix-hosted data source regardless (out of this phase's scope). A real member can prove who they are; what they're allowed to access still comes from the same mock fixtures mock mode uses. This is recorded as a known limitation, not silently assumed away.
- Adds a genuine new attack surface (a hand-rolled signed-cookie session) rather than an established library (NextAuth/Auth.js, etc.). Justified for this phase because the actual cryptographic surface is minimal (one HMAC sign/verify operation, no encryption, no JWKS, no third-party library to keep updated) and needed to work identically across the edge (middleware) and Node (Server Actions) runtimes without a heavier dependency; revisit if the app's auth needs grow past what this hand-rolled approach comfortably covers (e.g., real Wix token refresh/persistence, multi-provider login).

## Alternatives Considered

- **Use the Wix-hosted-redirect login page** (Wix's own "simplest" documented option): rejected — it requires the Wix site connected to Beacon Development to be published, a real, consequential change this phase's own instructions require presenting for approval before pursuing. The custom-login-page flow achieves the same outcome (real Wix member identity) without that requirement.
- **Store the browser-claimed organizationId directly as the trusted value** (i.e., keep today's architecture, just add a login wall in front of it): rejected outright — this is exactly the "never trust organizationId supplied by the browser as proof of authorization" failure mode the phase exists to close. A logged-in user could otherwise still claim any organizationId and reach another organization's data.
- **Pull in NextAuth.js/Auth.js for session management**: rejected for this phase — it solves a broader problem (many OAuth providers, database session adapters, etc.) than Beacon currently has, and "add only the packages required for this foundation phase" favored the smaller, auditable hand-rolled approach given the actual requirement (one signed cookie, two identity sources) is narrow. Worth revisiting if auth requirements grow materially.
- **Build a real organization-switcher UI for multi-membership users now**: rejected — explicitly out of scope ("do not build a polished organization switcher unless required for verification"). `selection_required` exists as a tested, real code path specifically so a future switcher has something correct to call into, without speculative UI being built ahead of need.
