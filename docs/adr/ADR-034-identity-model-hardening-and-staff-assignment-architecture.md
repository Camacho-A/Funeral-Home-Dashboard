# ADR-034: Identity Model Hardening & Staff Assignment Architecture

**Status:** Accepted
**Date:** 2026-08-06

## Context

Every phase since Phase 21 left the same gap unrepaired: Beacon had **three disjoint staff/identity concepts** that had never been reconciled — `StaffProfile` (Phase 4, pre-authentication, mock-only, exactly 3 fixture rows), `Identity`+`Membership` (Phase 21/22, the real login/RBAC system), and the older `OrganizationMembership` (Phase 13, still load-bearing for `AUTH_ADAPTER='mock'|'wix'` sessions). `docs/WIX_DATA_SCHEMA.md` carried an explicit "Open design decision... not implemented" note about this since Phase 14A. Phase 28 hit it three separate times in one phase (`recipientResolver.ts`'s `case_participants` scope, `SchedulingNotifier`, task-assignment notifications) and deferred all three, each time naming the identical root cause.

A dedicated design-validation pass (a self-critique step before the plan was ever presented) found three real gaps in the first draft: the mock-mode branches of `casesService.ts`/`tasksService.ts` would have silently bypassed all new validation (since they never reach a Route Handler at all); reusing a single permission key across case/task/appointment assignment would have conflated what the RBAC catalog's own `<resource>.<action>` convention keeps separate; and "renaming" `Resource.linkedMembershipId` would actually have been a live-data migration, not a low-risk rename. All three were resolved before implementation began, not left as gaps to be caught in review.

## Canonical identity architecture

```
Identity (authentication — Phase 21, unchanged)
   ↓
Membership (organizational authorization, org-scoped role — Phase 21/22, unchanged)
   ↓
StaffProfile (operational profile, org-scoped — hardened this phase)
   ↓
Operational assignments (Case, CaseTask, Appointment, Resource)
```

`StaffProfile` (`types/staffProfile.ts`) gained two required-shape fields: `identityId` (the canonical authenticated-identity id space — a real `Identity.id` in identity-mode, the legacy `AuthenticatedUser.id`/`OrganizationMembership.userId` space in mock/wix-mode) and `membershipId` (nullable — `Membership.id`, set only when a real `Membership` row exists). `StaffProfile.role` is **deprecated as authorization-relevant** — display-only, no RBAC legacy-alias mapping, never compared as a string to decide eligibility. Every eligibility check resolves the *real* role via the linked `Membership` and the existing RBAC permission system instead.

### Hard layering invariant

**No operational-assignment field on `Case`, `CaseTask`, `Appointment`, or `Resource` (nor a stored `NotificationRecipient` key) is ever allowed to point at `Identity.id` directly.** An operational reference always terminates at `StaffProfile.id`; `StaffProfile` is the only thing permitted to resolve further, through its own `membershipId`/`identityId`, into `Membership`/`Identity`. Concretely, this rules out ever adding a field like `Appointment.ownerIdentityId` — the correct and only shape is `Appointment.ownerStaffProfileId`, which is what this phase actually built. This is why `Resource.linkedStaffProfileId` was added as a *new* field rather than repurposing `Resource.linkedMembershipId` — the latter skips the `StaffProfile` layer entirely and would violate this invariant if pressed into service as "the" scheduling-assignment bridge.

This invariant governs *stored, operational* references — it does not retroactively change the separate, already-shipped **actor-attribution** fields (`Appointment.createdBy`/`lastModifiedBy`/`cancelledBy`, `CaseDocument.generatedBy`/`uploadedBy`, `SignatureRequest.requestedBy`/`cancelledBy`), which encode a different fact ("which authenticated session performed this action, for audit purposes") rather than "who is operationally responsible for this going forward." The two rules are orthogonal: assignment fields always terminate at `StaffProfile`; audit-attribution fields were always `Identity`-space and stay that way.

**`NotificationRecipient.identityId`** is the notification *platform's own delivery-layer* resolution, not a stored operational-assignment reference — it has to end up at an `Identity.id` (or `PortalUser.id` for the family scope) because that is literally what email/in-app delivery is addressed to. It is the last step of a pipeline that *starts* at a `StaffProfile.id`-space operational field and only crosses into `Identity.id`-space at the moment of dispatch, inside `recipientResolver.ts`/`notificationService.ts` — never stored back onto the originating entity. A grep-based structural test (`types/identityLayeringInvariant.test.ts`) asserts none of the four operational types ever declares a field literally named `*IdentityId`, as a forward-looking regression guard.

`Case.createdBy` stays in `StaffProfile.id`-space alongside `assignedStaffId`/`intakeOwnerId` — not migrated to `Identity.id`-space like its naming cousins elsewhere — because `casesService.create()` never receives an `ActivityContext`, only the `useSession()`-shaped `Session`, and nothing downstream ever joins `Case.createdBy` against `Identity`/`Membership` (`recipientResolver.ts`'s `case_participants` scope only ever reads `assignedStaffId`/`intakeOwnerId`). It gained a new runtime immutability guard, `assertCreatedByUnchanged` (mirroring `assertIntakeOwnerUnchanged` exactly, in `domain/cases/intakeOwnership.ts`) — it had none before this phase.

### Reserved extension point: `CaseStaffAssignment`

Today, `Case.assignedStaffId` assumes exactly one current handler per case forever. That assumption is convenient but not permanent, and this phase's schema choices are made so it can be lifted later without another migration of `Case`/`CaseTask` values. Sketch of the reserved shape (**not created this phase**):

```ts
// Reserved — not implemented in Phase 30.
type CaseStaffAssignment = {
  id: string;
  organizationId: string;
  caseId: string;
  staffProfileId: string;           // same StaffProfile.id space as every other field in this phase
  assignmentRole: string;           // e.g. 'primary_handler' | 'arranger' | 'director' | 'secondary' — open, extensible, never a hardcoded enum tied to StaffRole
  assignedAt: string;
  unassignedAt: string | null;      // soft-ended, never deleted — same historical-attribution rule as StaffProfile itself
};
```

The key compatibility guarantee: `Case.assignedStaffId` is designed as what a future `CaseStaffAssignment` table would call the row with `assignmentRole: 'primary_handler'` and `unassignedAt: null` — **`assignedStaffId` can become a denormalized, derived pointer to that row once the many-to-many table exists**, rather than a field that has to be dropped or reinterpreted. Nothing in this phase requires that migration to happen; it only requires that this phase's own `StaffProfile.id`-space convention (the hard layering invariant above) is the one a future `CaseStaffAssignment.staffProfileId` would use too, which it already is. This mirrors this codebase's own precedent for other deliberately-deferred future models (`PortalRelationshipType`'s reserved-but-uncapable entries, `SchedulingNotifier`'s reserved reminder method).

`Appointment.ownerStaffProfileId` (new, nullable) is not structurally required to also be a checked `Resource`/`AppointmentResourceAssignment` row this phase — a staff member can be a checked `Resource` on an appointment without being its owner, and vice versa. Documented as an accepted, named gap, not silently assumed enforced.

## Assignment model

| Field | Target space | Why |
|---|---|---|
| `Case.assignedStaffId` | `StaffProfile.id` | Current case handler — mutable, reassignable, RBAC-gated by `case.update`. |
| `Case.intakeOwnerId` | `StaffProfile.id` | Immutable after creation. |
| `Case.createdBy` | `StaffProfile.id` | Kept alongside its siblings; gained a new immutability guard this phase. |
| `CaseTask.assigneeStaffId` | `StaffProfile.id` | Mutable, reassignable, RBAC-gated by the new `task.assign`. Previously had **zero** existence/active/tenant validation at all. |
| `Appointment.ownerStaffProfileId` (**new**) | `StaffProfile.id` | "Who is primarily responsible" — RBAC-gated by `schedule.edit`. |
| `Resource.linkedStaffProfileId` (**new**, additive) | `StaffProfile.id` | Existence + org-match only (not full RBAC-gated assignment-eligibility — a `Resource` isn't a person being "assigned work" the way a Case/Task/Appointment assignment is). `Resource.linkedMembershipId` is left exactly as-is, not renamed — Wix Data has no field-rename primitive, and it was already live in ~6 files + 3 docs + this codebase's own ADR-031. |
| `Appointment.createdBy`/`lastModifiedBy`/`cancelledBy`, `CaseDocument.generatedBy`/`uploadedBy`, `SignatureRequest.requestedBy`/`cancelledBy` | `Identity.id` (unchanged) | Actor attribution — not part of this phase. |
| `PaymentRecord` | *(no change)* | No staff-actor concept exists; named as a reserved future extension point, not built here. |

**Permission-per-domain, not one shared permission:** case assignment gates on the existing `case.update`; appointment-owner assignment gates on the existing `schedule.edit`; task assignment gates on the new `task.assign` (bringing the RBAC catalog to **45** keys, tiered like `schedule.edit` — every default role except `accounting`/`readOnly`). `assertAssignableStaffProfile` takes the specific permission key as a parameter — one shared *mechanism*, never one shared *permission*.

## Service architecture

**`services/staffProfileService.ts`** (replaces the deleted `services/staffService.ts`) owns the `StaffProfile` operational-profile layer: `list`/`getById`/`create`/`deactivate` (the only lifecycle transition — never a hard delete, so historical assignments stay attributable forever), `resolveStaffProfileForCaller` (the `(organizationId, identityId)` lookup — the real replacement for `hooks/useSession.ts`'s pre-Phase-30 hardcoded stub), and two validation functions:

- `assertStaffProfileIsActiveAndInOrganization` — existence + active + org-match (+ linked-`Membership`-active, if set), **no permission check**. Used wherever no real RBAC actor exists to check one against: the mock branches of `casesService.ts`/`tasksService.ts` (Phase 4-era client-fetch services that execute directly in the browser, per those files' own header comments — mock-mode task/case mutation has never enforced RBAC beyond "the UI doesn't expose the control," and retrofitting that is out of this phase's scope), and `resourceService.ts` (a `Resource` bridge, not a person-assignment).
- `assertAssignableStaffProfile` — the above, plus the RBAC permission check, parameterized by permission key. Used everywhere a real `AuthorizationContext`/`ActivityContext` actor exists: every wix-mode API route (`app/api/cases/*`, `app/api/tasks/*`) and every genuinely server-side-only service (`schedulingService.ts`, which is never imported by a client hook).

Both never cache — mirrors `services/permissionService.ts`'s own "always resolves fresh, every call, with no shared state" rule (removed after the Phase 22 stale-cache incident); a single-row, indexed point query is not a new category of cost.

**`services/tasksService.ts`** gained real dual-branch validation for the first time — previously a pure client-fetch wrapper with a mock branch mutating `taskFixtures` directly and a wix branch that only POSTed, meaning route-level-only validation would have silently not applied in mock mode (this codebase's default, most-tested mode). Both branches now independently validate `assigneeStaffId`, mirroring `casesService.ts`'s own already-established dual-branch shape.

**Notifications completed** (Phase 28 deferred all three): `task.assigned` (POST/PATCH task routes, only on a genuine assignee change — never a no-op reassignment naming the same person already assigned), `scheduling.appointment_created`/`_rescheduled`/`_cancelled` (additive `notificationService.createNotification` calls in `schedulingService.ts`, right after each existing `recordAppointment*` call — mirroring exactly how Phase 28 added Signature's own additive notification call, notifying whoever `ownerStaffProfileId` names, if set), and `case_participants` (`recipientResolver.ts` now resolves `Case.assignedStaffId`+`intakeOwnerId` through `StaffProfile.identityId`, deduplicated, silently dropping an unresolvable/deactivated `StaffProfile.id` rather than throwing — the same non-error-empty-result precedent `organization_wide`/`role` scopes already establish).

## Security model

`assertAssignableStaffProfile` concretely prevents: **cross-organization assignment** (the target's `organizationId` must match; if `membershipId` is set, its own `organizationId` is independently re-checked too — closing the one dormant, unvalidated link `Resource.linkedMembershipId` already had); **assigning inactive/disabled/removed users** (`StaffProfile.isActive` models operational eligibility, `Membership.status === 'active'` models organizational eligibility, both independently checked); **orphaned assignments** (the write-side check rejects a nonexistent `StaffProfile.id` outright; the read-side never lets a pre-existing dangling reference crash resolution — dropped silently instead); **identity spoofing** (every lookup is by explicit id, never a `displayName`/email/username match at runtime — the migration's one-time email correspondence is a named, bootstrap-only exception, never a runtime code path); and **role-name comparison** (eligibility is decided entirely through existing RBAC permission checks against the caller's real `Membership`/`OrganizationMembership` role — never `StaffProfile.role`).

**`PortalUser` boundary reaffirmed**: `resolveStaffProfileForCaller`/`assertAssignableStaffProfile` are never called from any `/api/family/*` route — a `PortalUser.id` structurally cannot resolve against `StaffProfile.identityId`. `lib/auth/sessionIsolation.test.ts` was extended with a new structural assertion for this, exactly mirroring the pattern it already established for the staff/family session split.

## Migration

Fully additive, zero FK-value rewrites — `StaffProfile.id` values (`'staff-dana'`, etc.) stay exactly as-is everywhere already referenced. `services/staffProfileMigrationService.ts#migrateStaffProfiles` is two-phase (`options.apply: false | true`): a dry run only *resolves* a real `Identity` by the fixture's known email correspondence and reports per row, **never inventing an `Identity`** for a row that doesn't resolve; `apply` only then writes, idempotently (keyed by the deterministic `legacyStaffProfileId` — a row that already exists is reported `'already-existing'` and left untouched).

## Live Wix verification

The `staffProfiles` collection (9 fields, 2 indexes: `(organizationId, identityId)`, `(organizationId, isActive)`) was created live via the proven `POST /wix-data/v2/collections`/`POST /wix-data/v2/indexes` shapes and confirmed `ACTIVE`.

**The dry-run migration surfaced a real, expected finding rather than a bug**: of Manor's Cremation's three legacy `StaffProfile` fixture rows, only `staff-dana` resolved to a real live `Identity` (created by Phase 21's own identity migration); `staff-chris`/`staff-priya` — additive mock-fixture rows added *this* phase for parity, never part of any real live identity migration — correctly reported `unresolved`, exactly as designed. `apply` created `staff-dana`'s real `StaffProfile` row; a second `apply` run reported it `already-existing` (0 created), confirming idempotency. `staff-chris`/`staff-priya` remain a named, open gap: their `StaffProfile` rows will backfill automatically the next time this migration runs, once/if those two people are actually invited through the real invitation flow and get a real live `Identity`.

**A second real gap was found and fixed live**: `assertAssignableStaffProfile`'s permission check failed for `task.assign` against every role, because the live `rolePermissions` collection — seeded once in Phase 22 — had no grants for a permission key this phase only just added to the code catalog. Resolved via the identical targeted, quota-efficient fix Phase 27/28 already established for this exact scenario (a full `seedPlatformDefaultRoles` re-run hit the same `HTTP 429` rate limit Phase 28's own closeout also hit; the fix was to insert only the specific missing `(roleKey, 'task.assign')` grants directly — 5 rows, not a few hundred). **Any phase that adds a new permission key to an existing role's tier must re-seed live `rolePermissions` for that key specifically — this is not automatic.**

The rest of the live verification confirmed, against real and disposable data: `resolveStaffProfileForCaller` resolves Dana's real `StaffProfile` from her real live `Identity`; `assertAssignableStaffProfile` accepts a valid target (`task.assign`, `schedule.edit`) and rejects both a nonexistent `StaffProfile.id` and a cross-organization one (a disposable `StaffProfile` row inserted into a synthetic second organization, deleted afterward); `case_participants` resolves Manor's Cremation's real, already-existing case to Dana's real `identityId` (read-only, no mutation); and — via one disposable synthetic case row, deleted afterward — `case_participants` silently drops an unresolvable staff reference (`staff-priya`, no live `StaffProfile` yet) while still resolving the one that does. No live `signatureRequests`/`caseDocuments`/`appointments` rows exist yet for Manor's Cremation to spot-check actor-attribution against — confirmed absent, not a failure; that invariant is otherwise unchanged by this phase and remains covered by every pre-existing mock-mode test. Every disposable row created was deleted; a final query confirmed zero residual rows.

This session's live-Wix actions (creating the `staffProfiles` collection, running the migration, exercising validation/notification logic, re-seeding `rolePermissions`) required an explicit, separately-obtained user sign-off beyond the phase's own standing approval, consistent with this session's own heightened caution around actions touching a real external system.

## Permissions

One new key: `task.assign` (tiered like `schedule.edit` — every default role except `accounting`/`readOnly`). Total permission count moves from 44 to **45**.

## Deferred

- **`staff-chris`/`staff-priya` have no real live `Identity`/`StaffProfile` yet** — named above, not silently worked around. Resolves automatically on a future migration re-run once they're actually invited.
- **`PaymentRecord`'s staff-actor gap** — no field of any kind exists; out of scope for this phase (a future `PaymentRecord.initiatedByStaffProfileId` is a reserved, unbuilt extension point).
- **`CaseStaffAssignment`** — reserved extension point, sketched above, not implemented.
- **RBAC itself was not redesigned** — every check here reuses the existing permission-catalog/policy-service machinery unchanged.
- **HR/Payroll/Time tracking/Staff scheduling optimization/Employee records/Performance management/Custom RBAC redesign/Family identity changes/Workflow automation/AI staff routing** — explicitly out of scope, per the approved plan.
