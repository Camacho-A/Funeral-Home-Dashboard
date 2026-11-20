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

Already shared by all three: case read/create/update/reassign, case order,
payments read/collect, documents, `crematory.send`, fax send/confirm,
scheduling, tasks, notifications send, operational reports, audit read,
inventory/procurement.

## Not aligned — kept as they are (decide if any should change)

| Kind | Permissions | Today |
|---|---|---|
| Security | `organization.manage`, `settings.manage`, `user.invite`, `user.remove`, `user.manageRoles`, `audit.export`; credential administration (via `organization.manage`) | Admin (Manager: `user.invite`, `audit.export`) |
| Financial authority | `payment.refund`, `caseOrder.reprice`, `accounting.manage/post/reconcile`, `ap.manage`, `ap.pay` | Admin (Manager: `ap.manage`, `ap.pay`) |
| Catalog (recorded Gus decision) | `serviceCatalog.edit/price/deactivate` | Admin only |
| Destructive | `case.delete` | Admin |
| Configuration | `workflow.edit/publish`, `document.template.manage`, `notification.manage/admin`, `calendar.manage`, `signature.manage`, `portal.manage` | Admin, Manager |
| Configuration | `caseNumber.manage` | Admin, Funeral Director (a Manors cutover grant) |
| Crematory record (earlier decision) | Checking "Permit / Authorization sent to crematory" **by hand**, and correcting an earlier-send record | Admin only (SOLIS checks them itself on a send) |

Tests: `services/gusRolePermissions.test.ts` (every operational key held by
all three; restricted keys not handed out; Manors unchanged), plus the
existing onboarding and pricing-matrix tests.
