# ADR-015: Multi-Tenant Authorization Hardening

**Status:** Accepted
**Date:** 2026-07-23

## Context

Since Phase 13 (Authentication & Organizations), `app/(portal)/layout.tsx` has correctly resolved `organizationId` server-side from the authenticated session via `lib/auth/authorize.ts`'s `resolveAuthorizationContext` — never trusting a browser-supplied value for page rendering. But the Wix-backed Route Handlers introduced across Phases 15A–15D (`/api/organizations/[organizationId]`, `/api/workflow-templates`, `/api/workflow-templates/[templateId]`, `/api/cases`, `/api/cases/[caseId]`, `/api/tasks`) never applied that same discipline: each one read `organizationId` from a path or query parameter and used it directly to scope its mock/Wix query, with no check that the *caller's own session* actually has an active membership in that organization.

This was worse than "a code smell" — it was a live gap. `middleware.ts`'s matcher deliberately excludes `/api/*` (`'/((?!api|login|_next/static|_next/image|favicon.ico).*)'`), by design, so these routes have never had even a session check at the edge. In practice this meant **any HTTP client — authenticated or not — could call any of these six routes directly with any `organizationId` and receive that organization's real data** (or, in mock mode, any mock organization's fixture data). The gap was identified during Phase 15B's own review and tracked in `docs/ROADMAP.md`'s "Planned: Multi-Tenant Authorization Hardening" section and `docs/AUTHENTICATION.md`'s "Known limitations" ever since, explicitly deferred to this dedicated phase.

## Architecture Review Findings (performed before any code was written, per this phase's own instructions)

1. **Authenticated identity** is already resolved uniformly regardless of `AUTH_ADAPTER`: `lib/auth/session.ts`'s `getSession()` reads and verifies Beacon's own signed session cookie (`lib/auth/sessionToken.ts`), returning the same `AuthSession` shape whether the underlying login was mock or real Wix (`AuthenticatedUser.source: 'mock' | 'wix'` is the only distinguishing field, and nothing downstream branches on it).
2. **`AUTH_ADAPTER=mock`** works exactly as `lib/auth/mockAuth.ts` + `lib/auth/session.ts` already implement it — a hardcoded credential check issuing the same kind of signed session cookie as any other login path. Unchanged by this phase.
3. **Organization membership** is already modeled: `types/organization.ts`'s `OrganizationMembership` (`{organizationId, userId, role, isActive}`), seeded in `services/__mocks__/authFixtures.ts`'s `mockMembershipFixtures`. Read exclusively from mock fixtures today regardless of `DATA_ADAPTER` — there is no Wix `organizationMemberships` collection being queried yet, even though one exists in the Wix project (seeded, unused) — a pre-existing, explicitly out-of-scope limitation (see "Remaining work," below).
4. **Route Handlers currently determine organization access** by trusting the raw request parameter, full stop — confirmed by direct inspection of all six routes.
5. **An authorization abstraction already exists and is well-designed**: `lib/auth/authorize.ts`'s `resolveAuthorizationContext(session, requestedOrganizationId?)` — already used by the portal layout, already fully unit-tested (`authorize.test.ts`, `authIntegration.test.ts`) for single-membership auto-selection, multi-membership selection-required, inactive-membership rejection, and forged/fabricated `organizationId` rejection.
6. **Conclusion: no fundamental gap.** The existing abstraction is sufficient and correctly designed for this phase's goal — it simply was never wired into the Route Handlers. This phase's job is to close that wiring gap, not to redesign authentication or membership modeling.

## Decision

Add one new, thin function — `lib/auth/requireAuthorizedOrganization.ts`'s `requireAuthorizedOrganization(requestedOrganizationId)` — that composes the two things a Route Handler needs and a Server Component doesn't already have: reading the session itself (`getSession()`) and turning a denial into a standardized `NextResponse`. It does not reimplement any authorization decision — that remains entirely `resolveAuthorizationContext`'s job, unchanged.

```ts
type RouteAuthorizationResult =
  | { authorized: true; context: AuthorizationContext }
  | { authorized: false; response: NextResponse };
```

Every affected Route Handler now calls this immediately after validating `organizationId` is present, before any mock/wix branching, and uses `context.organizationId` (never the raw request value) for the query that follows:

```ts
const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
if (!authResult.authorized) return authResult.response;
const { organizationId } = authResult.context;
```

**Standardized failures:** no session at all → `401 { error: 'Authentication required.' }`. A session that exists but isn't authorized for the requested organization — for *any* reason (no membership, inactive membership, organization itself inactive, or a fabricated id that matches nothing) — → the identical `403 { error: 'Not authorized for this organization.' }`. These reasons are deliberately collapsed into one response: distinguishing them externally would leak exactly the "organization existence" and "membership shape" information this phase's own requirements forbid disclosing.

**No client-side change was needed.** `useOrganization()`'s `organizationId` was already server-resolved (Phase 13) and is not the security boundary here — the actual boundary is the Route Handler itself, which now re-derives authorization independently of whatever value arrives in the request, exactly as this phase requires ("no client-supplied organizationId should ever determine what data the server returns"). `services/*.ts` client functions were not modified: they still pass `organizationId` to the Route Handler, but that value is now correctly treated as a display/requested hint, not a trust boundary.

## Consequences

- **A behavioral change, deliberately**: several existing route tests previously asserted "a mismatched/nonexistent `organizationId` returns an empty list/404" — those cases are now rejected earlier, with `401`/`403`, before the mock fixture or Wix query ever runs. This is strictly stronger (an unauthorized caller no longer learns "this specific id has zero records" vs. "this id doesn't exist" — both now look identical), so the affected tests were updated to assert the new, correct status codes rather than preserved as regressions.
- **`AUTH_ADAPTER=wix` compatibility requires no changes to this phase's code.** `requireAuthorizedOrganization` operates purely on the adapter-agnostic `AuthSession`/`AuthorizationContext` types already unified in Phase 13 — it has no knowledge of `AUTH_ADAPTER` at all. A future real Wix member login only needs to produce the same `AuthSession` shape (which `lib/auth/wixAuth.ts` already does) for this entire authorization layer to work unchanged.
- **TanStack Query cache keys are unaffected.** Every query key already led with `organization.organizationId` (Phase 15E confirmed this); since this phase changes only server-side enforcement and not what value `useOrganization()` supplies, no cache-key or invalidation change was needed or made.
- **Future Phase 16 write endpoints must reuse `requireAuthorizedOrganization`** rather than re-deriving authorization inline — this was the explicit design goal ("Future write endpoints in Phase 16 should reuse this service without redesign").

## Remaining, Explicitly Deferred Limitations (unchanged by this phase)

- **Organization membership still has no real (Wix) data source.** `findActiveMemberships` inside `resolveAuthorizationContext` reads mock fixtures regardless of `DATA_ADAPTER` — a real Wix member's organization access still cannot be resolved from anything Wix-hosted. Reading a real `organizationMemberships` collection is identity-model work, explicitly deferred to before/during Phase 16 per repeated prior-phase instructions, and was correctly out of this phase's scope ("do not implement Wix authentication during this phase unless absolutely required" — it was not required, since `resolveAuthorizationContext` already abstracts over this).
- **`middleware.ts` still excludes `/api/*`.** This was a deliberate choice, not an oversight: API routes need to return a JSON error body (`401`/`403`), not an HTML redirect to `/login`, so gating them at the edge with the existing redirect-based middleware would have been the wrong mechanism. Each Route Handler now independently enforces authentication and authorization at the exact point of data access instead.
