# Gus role permissions (2026-11)

**Decision (funeral home, 2026-11):** Administrators, Managers and Funeral
Directors have equivalent **operational** access — case management, service
preparation, release requests, release holds and permitted crematory sending.
The Funeral Director role is not required merely to use these functions.

**Unchanged and independent:** a licensed director's sign-off. Releasing (or
reauthorizing after a hold) needs a person who is a Funeral Director by role
(or holds an authorization granted by someone else) **and** has a verified
license (`cremationReleaseApproverRoleKeys` + the credential record). Being an
Administrator or Manager never counts as being licensed. Nobody can enter,
verify or authorize their own credentials, or give themselves the Funeral
Director role.

## How it is applied

| Where | Mechanism |
|---|---|
| Default-role gaps | Gus-only standing overrides, `GUS_OPERATIONAL_ALIGNMENT` in `domain/organization/organizationProfiles.ts`, written as Gus-scoped override rows at onboarding (`services/roleService.ts › seedStandingRoleOverrides`). No shared role row and no Manors row is written. |
| Release requests and holds | `features.cremationReleaseOperatorRoleKeys = ['administrator', 'manager', 'funeralDirector']` (Gus only; platform default empty). |
| Licensed sign-off | `features.cremationReleaseApproverRoleKeys = ['funeralDirector']` + authorization + verified license — unchanged. |
| Every route | Still requires `case.update` (or the route's own permission) **and** the organization from the session. Read-only users can do none of this. |

## Aligned (granted to whichever of the three lacked it)

| Permission | Was | Now |
|---|---|---|
| `caseOrder.customItems` | Admin, Manager | + Funeral Director |
| `resource.manage` (scheduling resources, conflict override) | Admin, Manager | + Funeral Director |
| `user.read` (team list) | Admin, Manager | + Funeral Director |
| `report.export` | Admin, Manager | + Funeral Director |
| `dashboard.manage` (shared report presets) | Admin, Manager | + Funeral Director |
| `merchandise.manage` | Admin, Manager | + Funeral Director |
| `inventory.adjust` | Admin, Manager | + Funeral Director |
| `accounting.view`, `accounting.report` (financial visibility) | Admin, Funeral Director | + Manager |
| `workflow.edit`, `workflow.publish` (approved 2026-11-20) | Admin, Manager | + Funeral Director |
| `document.template.manage` (approved 2026-11-20) | Admin, Manager | + Funeral Director |
| `caseNumber.manage` (approved 2026-11-20; every change audited) | Admin, Funeral Director | + Manager |
| `ap.manage` — enter, correct (void and re-enter) and review vendor bills (approved 2026-11-20, final safety pass) | Admin, Manager | + Funeral Director (`ap.read` already held) |

Also approved 2026-11-20 (profile settings, not permission keys):

| What | Setting | Who (Gus) |
|---|---|---|
| Release requests, holds, withdrawals, corrections | `cremationReleaseOperatorRoleKeys` | Admin, Manager, Funeral Director — a correction of an active release needs confirmation by a different person (not the requester, not the signer or requester of that release) |
| Funeral director credential administration — never one's own; verification independent of the holder | `funeralDirectorCredentialAdministratorRoleKeys` (`canAdministerFuneralDirectorCredentials`) | Admin, Manager, Funeral Director |
| Checking the two "sent to crematory" steps by hand — the release gate is still enforced on the server | `sendToCrematory.sentStepsByHandRoleKeys` (`maySetCrematorySentStepsByHand`) | Admin, Manager, Funeral Director |
| Licensed sign-off (unchanged) | `cremationReleaseApproverRoleKeys` + authorization + verified license (re-verified every 365 days) | Funeral Director by role, or a granted authorization |

Case-number audit: sequence seeding/resync record `case.sequence.initialized`
(existing); a prefix change now records `case.number_prefix.changed`. A
prefix change still also needs `organization.manage` (it is part of the
Organization Profile).

Already shared by all three: case read/create/update/reassign, case order,
payments read/collect, documents, `crematory.send`, fax send/confirm,
scheduling, tasks, notifications send, operational reports, audit read,
inventory/procurement.

## Not aligned — kept as they are (decide if any should change)

| Kind | Permissions | Today |
|---|---|---|
| Security | `organization.manage`, `settings.manage`, `user.invite`, `user.remove`, `user.manageRoles`, `audit.export` | Admin (Manager: `user.invite`, `audit.export`) |
| Financial authority | `payment.refund`, `caseOrder.reprice`, `accounting.manage/post/reconcile`, `ap.pay` | Admin (Manager: `ap.pay`) — Funeral Directors have **no vendor payment authority** (2026-11-20) |
| Catalog (recorded Gus decision) | `serviceCatalog.edit/price/deactivate` | Admin only |
| Destructive | `case.delete` | Admin |
| Configuration | `notification.manage/admin`, `calendar.manage`, `signature.manage`, `portal.manage` | Admin, Manager |
| Crematory record | Correcting an earlier-send record | Admin only (not part of the 2026-11-20 decisions) |

Tests: `services/gusRolePermissions.test.ts` (every operational key held by
all three; restricted keys not handed out; Manors unchanged), plus the
existing onboarding and pricing-matrix tests.
