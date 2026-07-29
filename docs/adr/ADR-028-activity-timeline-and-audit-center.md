# ADR-028: Case Activity Timeline & Audit Center

**Status:** Accepted
**Date:** 2026-08-01

## Context

Beacon had reinvented "record what happened" four separate times — `organizationRoleAuditEntries` (Phase 22), `caseOrderAuditEntries` (Phase 19C), `onboardingAuditEntries` (Phase 20), `loginActivityEvents` (Phase 21) — and none of them was rendered anywhere in the app: three were write-only, one (`caseOrderAuditEntries`) was fetched by a hook but never displayed. Meanwhile the Case Detail page's "Activity Log" (`domain/cases/timeline.ts`) was not an event log at all — a pure derivation that walks completed checklist items at read time and guesses the actor from the checklist label text via regex. There was no persisted, general-purpose record of "who did what, when" anywhere in the system.

This phase builds that foundation once: a single, append-only `ActivityEvent` model and `services/activityService.ts`, a real Case Activity tab backed by persisted events, and an organization-wide Audit Center.

## Architecture decision

One new generalized, append-only `ActivityEvent` model. The four legacy audit collections are left completely untouched — no writes, no schema changes, no behavior changes — migrating their write paths onto the new service is explicit, deliberate future work, not attempted this phase (avoids touching already-shipped, heavily-tested Phase 20–23 code for zero immediate user benefit, since none of those four collections had any live reader to begin with).

None of the four legacy collections was a good base to extend instead of generalizing: `organizationRoleAuditEntries` is RBAC-shaped (`roleId`/`previousRoleKey`), `caseOrderAuditEntries` is pricing-shaped (`amountDeltaCents`), `onboardingAuditEntries` has no case scoping, `loginActivityEvents` has no required organization scoping. Building the general envelope once, rather than contorting a specific one four different ways, is the direct application of "generalize, don't duplicate."

## Invariants

- **Append-only, immutable, permanently.** `services/activityService.ts` imports only `insertWixDataItem` from `lib/wixDataApi.ts` — never `updateWixDataItem`/`deleteWixDataItem`. A correction to a past event is always a new event (referencing the old one via `metadata`), never an edit. Enforced at the code level (a source-inspection test asserts the import list), not just documented.
- **`previousValue`/`newValue` carry only changed fields, never a full entity snapshot.** `recordCaseUpdated`'s signature — `Record<fieldName, {previous, next}>` — makes this the natural shape rather than something a caller has to remember; a caller would have to deliberately enumerate every field on an entity to defeat it.
- **`correlationId` is a property of the request, not the event.** Generated once per request, threaded through every `record*` call that request makes. A single case-order recalculation that produces several diff entries records **one** event with all of them, not one event per diff — the API request is the unit of correlation, not the individual field change.
- **`eventVersion`** starts at 1 on every event, reserved for a future schema evolution of a given `eventType`'s payload shape without breaking how old rows are read.

## Data model and controlled taxonomy

`types/activityEvent.ts` defines `ActivityEvent` (organization, optional case, actor identity/membership/role-at-the-time, category, dot-notation `eventType`, resource type/id, previous/new value, a precomposed `description` kept fully separate from `eventType`, `metadata`, `severity`, `correlationId`, `isSystemGenerated`, timestamps) and `ACTIVITY_EVENT_TYPES` — a controlled registry of stable, dot-notation machine identifiers (`case.created`, `case.stage.changed`, `payment.recorded`, `team.member.invited`, ...). Every entry is annotated as either wired this phase or reserved (with the reason), so future phases add a builder helper and a call site, never a data-model change.

Twelve typed builder helpers (`recordCaseCreated`, `recordStageChanged`, `recordPaymentRecorded`, `recordCaseOrderChanged`, ...) sit on top of the low-level `record()` — no call site in this codebase hand-constructs a raw event payload.

## What got wired this phase, and what didn't — verified, not assumed

Two things were discovered during implementation that the original plan had gotten wrong, and are recorded here rather than silently corrected:

1. **Cases/tasks only reach the server in `DATA_ADAPTER=wix` mode.** `app/api/cases/route.ts`, `app/api/cases/[caseId]/route.ts`, and `app/api/tasks/[taskId]/route.ts` all explicitly require `DATA_ADAPTER=wix` — mock-mode case/task mutations run entirely client-side (`services/casesService.ts`/`tasksService.ts`), a pre-existing Phase 0–16 architecture pattern, not something this phase introduced. Activity events for case create/update/stage-change/task-completion are wired into these routes and will only be recorded when running against real Wix, not local mock-mode dev.
2. **`services/caseLogService.ts` (case notes/contacts) has no server-side or Wix integration at all, in any mode.** It's pure client-side mock fixtures with zero API route behind it. `case.note.added`/`case.contact.logged` are therefore **reserved, not wired** this phase — there is nothing to hook an emitter into. The original plan assumed this could be wired; it can't, until case logs get their own Wix integration in a future phase.

Payments (`app/api/cases/[caseId]/payments/clover/checkout`, `app/api/webhooks/clover`, `.../[paymentId]/cancel`) and case-order pricing (`services/pricingService.ts`) both run fully server-side in both modes and are wired for real in both.

## Performance: keyset pagination, not offset

Wix Data supports neither native cursor pagination nor an operator-rich query DSL beyond basic equality/range filters and `sort`. `services/activityService.ts` implements keyset (seek) pagination: a `cursor` is a base64url encoding of `{createdAt, id}`. In wix mode, `createdAt <= cursor.createdAt` is pushed down as a range filter (narrowing what Wix scans, live-verified to work against the real API), but the *exact* boundary (`<`, with `id` as a same-millisecond tiebreaker) is always re-applied in application code on the resulting window — the server-side filter is an efficiency narrowing, not the correctness mechanism. This avoids offset pagination's well-known "page drift under concurrent inserts" problem using only the primitive Wix Data actually has.

**`activityEvents` (Collection 31)** has exactly 3 regular indexes (the platform cap, confirmed live via `capabilities.indexLimits`): `(organizationId, createdAt)`, `(organizationId, caseId)`, `(organizationId, category)`. Filtering by actor, resource type/id, event type, severity, or free text happens in application code after an org(+date or +case)-bounded fetch — a real, documented scaling ceiling, mitigated (not eliminated) by defaulting the Audit Center UI to a recent date range.

## Permissions

Two new keys, not three: `audit.read` (mirrors `report.view`'s distribution — Administrator, Manager, Funeral Director, Accounting, Read Only) and `audit.export` (narrower, mirrors `payment.refund`'s distribution — Administrator, Manager, Accounting). No separate `audit.case.read`: the Case Activity tab route reuses the same `requireAuthorizedOrganization` gate `GET /api/cases/[caseId]` itself uses — case routes were never migrated to RBAC permission checks in any prior phase, so introducing one only for the activity sub-resource would be a new, inconsistent gate rather than "reusing an existing policy" (an incorrect assumption in the original plan, corrected here).

## Live verification

A disposable throwaway organization pair + case, `DATA_ADAPTER=wix`, via the real service functions (not raw REST): created the `activityEvents` collection and its 3 indexes (index cap empirically reconfirmed); recorded one event per wired builder helper; confirmed `listForCase`'s keyset pagination across two pages with zero overlap; confirmed `listForOrganization`'s category and date-range filters; confirmed cross-tenant isolation (a second organization's events never appeared in the first's results, including for a deliberately-shared `caseId` string); confirmed CSV export's shape and row count. Every row created was deleted afterward — a final unfiltered query confirmed zero rows remained.

## Deferred

- Migrating the four legacy audit writers onto `services/activityService.ts`.
- `case.note.added`/`case.contact.logged` — blocked on `caseLogService.ts` getting a real Wix integration.
- `payment.refunded`, `document.uploaded`/`generated`/`signed` — blocked on those features existing at all.
- PDF export (CSV ships this phase; no PDF-generation dependency added).
- Archival/retention beyond "never deleted" — no organization is near a volume where it matters yet.
