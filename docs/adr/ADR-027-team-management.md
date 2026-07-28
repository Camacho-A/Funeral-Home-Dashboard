# ADR-027: Team Management

**Status:** Accepted
**Date:** 2026-07-30

## Context

Phases 21–22 built a complete, concurrency-hardened identity/membership/RBAC backend (`Identity` → `Membership` → `Role` → `Permission`), but no UI ever consumed most of it for day-to-day staff administration. Before building that UI, an audit confirmed the backend was sound and did **not** need re-architecting, but found three small, genuine gaps a Team Management UI cannot be built without:

1. No route lists pending (`status: 'invited'`) memberships — `GET /api/rbac/members` filters to active only.
2. No route revokes a pending invitation — `/api/auth/invitations` had `POST` (invite) and `PATCH` (resend) only.
3. No route exposed the already-guarded `RoleService.setMembershipStatus` (disable/reactivate/remove) — flagged as deferred in ADR-026.

This phase closes those three gaps with small, additive service/route wiring — **no new Wix collections, no changes to the lock/fencing/permission-resolution architecture** Phase 22 already hardened through three security-correction rounds — then builds the Team Management UI on top.

## The three prerequisite backend additions

### 1. Listing pending invitations

`services/invitationService.ts`'s new `listPendingInvitations(organizationId, dataAdapterMode)` filters `listMembershipsForOrganization` to `status: 'invited'`, then enriches each row with what the Team page needs: `email`/`displayName` (via `getIdentityById`), and `expiresAt`/`lastResentAt`/derived `status: 'pending' | 'expired'` — computed from `emailVerificationTokens`, sorted by `createdAt`, taking the latest token as authoritative. **"Expired" is a UI-only derived label, not a stored `MembershipStatus` value** — an expired invitation is still `status: 'invited'` underneath and behaves identically to a live one for every other purpose, including revoke. Exposed via `GET /api/auth/invitations?organizationId=...`, gated by `canInviteUser` (`user.invite`) — the same permission that already gates inviting and resending.

`services/emailVerificationService.ts` gained the query function this needed, `listTokensForIdentity` — the `emailVerificationTokens(identityId)` index this relies on already existed (per `WIX_DATA_SCHEMA.md`); no function had queried it yet.

### 2. Revoking a pending invitation

`services/invitationService.ts`'s new `revokeInvitation` transitions `status: 'invited'` → `'removed'` and invalidates every live email-verification/acceptance token for that identity (`invalidateTokensForIdentity`, new in `emailVerificationService.ts` — marks every not-yet-used token as used, reusing the exact `usedAt` check `verifyEmailWithToken` already enforces, so a revoked invitation's link can never be replayed regardless of how many times it was resent).

Deliberately does **not** run under `organizationLockService`'s per-organization lock: an invited (not-yet-active) membership never counts toward the last-administrator invariant (`countActiveAdminTierMembers` only considers active memberships), so there is no race here for the lock to protect against.

Idempotent on an already-revoked invitation (`already_revoked`, no error, no duplicate audit entry). Refuses — rather than silently no-op'ing — to touch an already-accepted invitation (`already_accepted`, surfaced as HTTP 409): revoke and "disable/remove an active member" are different lifecycle events, and conflating them could let a stale UI action accidentally deactivate a real, active member. Exposed via `DELETE /api/auth/invitations`, same `canInviteUser` gate.

### 3. Membership status management

`RoleService.setMembershipStatus` already existed, fully guarded (admin-invariant check, `commitProtectedWrite`) since the prior security-correction rounds — it was simply never wired to a route. Two real gaps were fixed as part of exposing it:

- **Reactivation was never audited.** The `status === 'active'` branch unconditionally returned `auditEntry: null`. It now writes a `membership_reactivated` entry (no admin-invariant check needed for reactivation — it can only ever add an administrator back, never remove one).
- **`'removed'` is now explicitly terminal.** Previously nothing prevented reactivating or re-disabling a removed membership. `setMembershipStatus` now refuses any transition away from `'removed'` (`"This membership was removed. Invite them again instead."`) — re-adding someone requires a fresh invitation, not a status flip.
- **Idempotency**: setting a membership to its already-current status is now a no-op (no lock, no write, no duplicate audit entry) rather than re-running the admin-invariant check and rewriting an unchanged row.
- **A pending (`'invited'`) membership is explicitly refused** with a message pointing at `revokeInvitation` instead — the two lifecycles (pre-acceptance vs. post-acceptance) don't overlap.

Exposed via `PATCH /api/rbac/membership-status` (new route), gated by `canRemoveUser` (`user.remove` — already existed in the permission catalog, simply unused until now). The route itself adds one guarantee no service function could enforce on its own: **a caller may never target their own membership** — self-service disable/removal is out of scope, independent of admin count.

### Audit action taxonomy

`OrganizationRoleAuditAction` gained four values: `invitation_revoked`, `membership_disabled`, `membership_reactivated`, `membership_removed`. Phase 22's `setMembershipStatus` had overloaded `role_removed` for every status change, conflating role-lifecycle events with membership-lifecycle events — this phase's audit entries use the specific new action instead. `role_created`/`role_cloned`/`role_updated`/`role_deleted`/`role_assigned`/`role_removed` are untouched. `lib/wixOrganizationRoleAuditEntryMapper.ts`'s `VALID_ACTIONS` allowlist was updated to include the four new values — without this, a live-mode read of a Phase 23 audit entry would have failed to map (returned `null`) and silently vanished from `listAuditEntries`.

No Wix schema change was required: `organizationRoleAuditEntries.action` is stored as free `TEXT`, not a Wix-level enum — confirmed live (see below), not assumed.

## Live verification

A throwaway script (`DATA_ADAPTER=wix`, deleted after use — never committed, per this project's standing convention) exercised the real service functions, not raw REST calls, against a disposable throwaway organization and disposable test identities/memberships:

1. `revokeInvitation` on a genuine invited membership: confirmed `invited` → `removed`, confirmed the idempotent second call returns `already_revoked`.
2. `setMembershipStatus` disable → reactivate → remove, in sequence, against a real active membership (alongside a standing live administrator membership, so the invariant wasn't spuriously tripped by the throwaway org having zero administrators to begin with): confirmed each status transition and its corresponding new audit action (`membership_disabled`, `membership_reactivated`, `membership_removed`).
3. Attempted to reactivate the now-`removed` membership: confirmed the terminal-state rejection fires live, not just in mock mode.
4. Queried `organizationRoleAuditEntries` for the throwaway org and confirmed all four new action values round-tripped through the real Wix `TEXT` field with no error and no `PUT /wix-data/v2/collections` schema change.
5. Every row created by the script (identities, memberships, audit entries, tokens, `organizationRoles` enablements for the throwaway org) was deleted afterward — the live database was left exactly as it was found, aside from the pre-existing, shared, global platform-default `roles`/`permissions`/`rolePermissions` rows `seedDefaultRoles` found already seeded (not created by this script).

## Tests

`services/invitationService.test.ts`: `listPendingInvitations` (fields, `expiresAt`/`lastResentAt` derivation, cross-org exclusion, excludes active memberships), `revokeInvitation` (revoked, idempotent-already-revoked, rejects already-accepted, token invalidated). `services/emailVerificationService.test.ts`: `listTokensForIdentity`, `invalidateTokensForIdentity` (idempotent). `services/roleService.test.ts`: reactivate now audits; `'removed'` is terminal; idempotent no-op produces no duplicate audit; pending-invitation guard. `lib/wixOrganizationRoleAuditEntryMapper.test.ts`: round-trips one of the four new action values. `app/api/auth/invitations/route.test.ts`: new `GET`/`DELETE` cases (permission gate, CSRF, cross-org 404, already-accepted 409, idempotent revoke). `app/api/rbac/membership-status/route.test.ts` (new file): permission gate, CSRF, self-target 400, admin-invariant 409 (isolated via a custom role granting `user.remove` without `organization.manage`, so the caller doesn't themselves count toward the invariant), terminal-`removed` 409, idempotent no-op.

## What this phase deliberately defers

The Team Management UI itself (page, components, hooks, mutations, confirmation dialogs) is built as a separate, subsequent step on top of these three backend additions — this ADR covers the backend prerequisites only. See `docs/ROADMAP.md` for the UI scope.
