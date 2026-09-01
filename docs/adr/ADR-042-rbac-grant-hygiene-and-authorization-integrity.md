# ADR-042 — RBAC Grant Hygiene & Authorization Integrity (Phase 38)

Status: Accepted · Builds on ADR-022 (Role-Based Access Control, Phase 22) and the identity-model hardening of Phases 21/30.

## Context

Live verification during Phases 36–37 surfaced a class of **historical authorization-data defects** on the live `managed-cremations` site that no mock/unit test could catch — because the permission catalog, default-role definitions, and policy wiring are all correct in source; only the *materialized live grants* had drifted. A read-only live audit quantified it precisely across the seven platform-default roles:

- **25 expected default-role grants were never inserted** (e.g. all five `accounting.*` on both the administrator and accounting roles; `report.operational/.staff/.export`, `dashboard.manage`; `portal.message`; `signature.read`). Root cause: default-role grants are **global** (roles are `organizationId: null`, shared by every tenant) and are seeded lazily by `seedPlatformDefaultRoles`, which runs only inside provisioning flows — nothing re-ran it after later phases (31/32/…) added permissions to `DEFAULT_ROLE_DEFINITIONS`.
- **20 present grants were invisible to authorization** because they were seeded (by early verification scripts) without a `createdAt`, and `mapWixRolePermissionItem` required `typeof createdAt === 'string'`, mapping such rows to `null` — silently revoking a valid permission over missing, non-security metadata.

Net effect: the live administrator resolved only **50 of 64** permissions. This ADR makes the RBAC model reliable and prevents recurrence, without redesigning roles.

## Decisions

### 1. Mapper hardening — `createdAt` is non-fatal; security-critical fields stay fail-closed (D1)
`createdAt` is incidental persistence metadata; it is **never** read by an authorization decision (that is pure `Set.has(permissionKey)`). `mapWixRolePermissionItem` now normalizes a missing/non-string `createdAt` to a sentinel (`ROLE_PERMISSION_CREATED_AT_FALLBACK`) instead of dropping the grant. The security-critical fields — `beaconRolePermissionId`, `roleId`, and `permissionKey` (validated against the current catalog, so an unknown/stale key still resolves to no grant) — remain **fail-closed**. The affected live rows are *also* repaired by the reconciliation backfill (both, per D1), so the sentinel is a durable safety net rather than the steady state.

### 2. Additive, idempotent grant reconciliation (D3, D7)
A pure planner (`computeDefaultRoleReconciliationPlan`) diffs the live global default-role grants against the source-of-truth `DEFAULT_ROLE_DEFINITIONS` and emits only **additive** changes: insert a missing expected grant (deterministic id `rolepermission-<roleKey>-<permissionKey>`), or backfill a missing `createdAt` in place. It never deletes or overwrites, so it can never strand an org of administrators. `runDefaultRoleReconciliation` runs it in `dry_run` (read-only preview, mutates and persists nothing) or `apply` mode. Idempotent by construction: a second dry-run after an apply converges to **0 required changes**. **Manual invocation only** — nothing runs at startup or on deploy.

### 3. Global scope for shared default roles; custom roles stay org-scoped (D3)
Because default roles are platform-global, reconciliation is inherently **platform-wide** and is recorded once with a `PLATFORM` scope marker (`organizationId: null`) — never a fake per-organization audit fan-out. Organization-owned **custom roles** (`organizationId != null`, `isSystemDefault: false`) are never read or written by default-role reconciliation; the distinction is reliable in schema and structurally tested.

### 4. Deterministic ids for new custom-role grants (D2)
`createCustomRole` / `cloneRole` / `updateRole.addPermissions` now derive a grant's id deterministically from `roleId + permissionKey` (`customRolePermissionId`, hashed only if it would exceed Wix's 128-char `_id` cap). This is the sanctioned substitute for a compound-unique index Wix cannot provide: re-inserting the same grant is a no-op 409 (idempotent, never an overwrite; a collision can only be the *same* grant). **Prospective only** — existing random-id custom grants are left untouched; no historical row is re-identified.

### 5. Administrator invariant by set-equality, not a hardcoded count (D4)
The old `toHaveLength(64)` assertion is replaced by a structural invariant: **administrator's grant set equals `PERMISSION_KEYS`**. Adding a catalog key without granting it to administrator (or vice-versa) now fails CI. A companion test asserts every catalog key is granted by at least one default role (no orphaned key).

### 6. Dedicated reconciliation records + existing audit trail (D5, D8)
A new `rbacReconciliationRecords` collection persists each run's identity, mode, `PLATFORM`/`TENANT` scope marker, summary, and per-change prior state + rollback op — the rollback-bearing history. The existing `organizationRoleAuditEntries` remains the human-facing role/membership trail. The `rolePermission` row shape is unchanged (no `updatedAt` added — no demonstrated authorization requirement).

### 7. Read-only integrity service + admin surface (D6)
`rbacIntegrityService` provides a deterministic health check (`HEALTHY | DRIFT_DETECTED | MALFORMED_DATA | DUPLICATES | MISSING_DEFAULT_GRANTS` + safe counts) and an authorization diagnosis (Identity → Membership → role → expected → persisted → effective) answering "why is this administrator unauthorized?". Exposed via admin-only routes (`/api/rbac/integrity/health`, `/api/rbac/integrity/diagnose`, gated by `organization.manage`) and a minimal Security-page health badge. The global reconcile route (`/api/rbac/integrity/reconcile`) is gated by **platform administrator** (env allowlist) because an apply mutates shared global roles.

## Authorization model (confirmed, unchanged in shape)

`PERMISSION_KEYS` → `DEFAULT_ROLE_DEFINITIONS` → seeded global `roles`(org-null)+`rolePermissions` → per-org `organizationRoles` enablement → `Membership.role` (string key, legacy aliases) → `permissionService` resolves a fresh `Set<PermissionKey>` every request (no server cache) → `authorizationPolicyService.hasPermission`. Platform-admin is a separate env allowlist (`PLATFORM_ADMIN_USER_IDS`), never a tenant grant — Phase 38 does not touch it. `organizationId` is always resolved from the authenticated server context, never trusted from the client.

## Session / cache implications

There is no server-side permission cache (removed for correctness in a prior round), so a reconciliation apply takes effect on the **very next request** — no session revocation is introduced. The client TanStack-Query permission cache is a UI convenience that re-fetches; it can never grant an action the server wouldn't.

## Rollback

Every applied change carries a prior state + a targeted rollback op (`delete_grant` for an inserted row, `restore_created_at` for a backfill), keyed to the exact deterministic grant id the run touched — never a blanket delete — so grants created after a run are never affected.

## Live artifacts

Applied on the `managed-cremations` site after an explicit Live Wix Authorization Checkpoint (baseline audit → dry-run → approval → targeted additive apply → re-read → second dry-run proving 0 changes): the `rbacReconciliationRecords` collection + `organizationId` index were created, then **25 missing default-role grants were inserted and 20 `createdAt` values backfilled** across the seven global platform-default roles (`rolePermissions` 202 → 227; **0 removed/overwritten**). A single `PLATFORM`-scoped reconciliation record (`organizationId: null`) was persisted. Post-apply verification: **second dry-run = 0 changes**; administrator resolves **64/64** through the normal authorization path; all roles at their expected counts; custom roles (0) and membership role assignments unchanged; platform-admin semantics unchanged.

## Structural invariants (test-enforced)

Administrator == `PERMISSION_KEYS`; every default grant references a valid key; no orphaned catalog key; the mapper does not require non-security metadata to authorize while failing closed on `roleId`/`permissionKey`/`id`; reconciliation is additive-only, PLATFORM-scoped, and never modifies an org-owned custom role; deterministic custom-grant ids never collide across distinct grants or with default-grant ids.
