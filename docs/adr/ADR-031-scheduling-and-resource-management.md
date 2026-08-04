# ADR-031: Scheduling & Resource Management

**Status:** Accepted
**Date:** 2026-08-03

## Context

Every phase to date left scheduling as an explicitly-named, deliberately-deferred V2 candidate — `docs/ROADMAP.md`'s own words: "Booking chapels, hearses, crematory slots, and staff time for visitations, funerals, and cremations... with calendar/resource-conflict logic that doesn't exist in V1 at all." Three independent, deliberately-placed reservations already anticipated this phase: `types/activityEvent.ts`'s `ActivityEventCategory` already included `'scheduling'`, unused by any event type; `domain/documents/mergeEngine.ts` already reserved `case.service.date`/`case.service.location` as `wired: false`, with a comment naming exactly this handoff; ADR-030's own "Extension points" section already named "Witness signatures — just another `SignatureRequest`/`SignatureRecord` pair against the same `documentId`, with `SignerRole` widened" as reserved, unimplemented design intent.

This is genuinely greenfield at the data-model level: `CaseTask` has zero date/time/recurrence fields (an explicit test in `lib/wixTaskMapper.test.ts` asserts no such fields exist); `OrganizationLocation` is a physical-address record with no sub-resource concept; no staff member anywhere has an availability/calendar field; no calendar-grid component, date-range utility, or date-math library existed anywhere in this codebase before this phase.

**Explicitly out of scope this phase:** Google Calendar sync, Outlook sync, ICS feed generation, vehicle routing, SMS reminders, an email reminder platform, resource optimization, automatic scheduling, GPS tracking, fleet telematics, payroll, time clock. Each has a named extension point, never a stub implementation.

The plan for this phase went through one revision round before implementation began — twelve numbered architectural refinements, the most consequential of which (the hard Appointment/Resource separation, the appointment-type registry, the Draft lifecycle stage, hard-vs-soft conflicts, resource lifecycle states, and immutable recurrence definitions) are documented as their own sections below.

## Architecture: Appointment and Resource are two independent things, joined by exactly one table

The single most consequential decision this phase makes: **an `Appointment` (work being scheduled) never embeds any resource state, and a `Resource` (a thing assignable to work) never references any specific appointment.** The only bridge is `AppointmentResourceAssignment` — a real join table, `id = "${appointmentId}-${resourceId}"`. Every assignment, release, and conflict check flows exclusively through it.

This mirrors ADR-030's own `SignatureRequest`/`SignatureRecord` split for the identical reason: keeping two genuinely distinct concerns in two genuinely distinct tables, joined explicitly, is what lets either side evolve — a new resource type, a new appointment type, a future multi-resource-per-role assignment — without a schema migration to the other.

**Staff are a `Resource`, never a duplicated identity.** A `resourceType: 'staff' | 'funeral_director'` row carries `linkedMembershipId` (→ `Membership.id`) as its one and only connection to RBAC/identity — role, permission, and account status always resolve through the real `Membership`; no identity or role data is ever copied onto a `Resource` row.

## Appointment types: a registry, not string literals

`domain/scheduling/appointmentTypeRegistry.ts` mirrors `domain/documents/documentTypeRegistry.ts`'s exact convention: a controlled, dot-notation `APPOINTMENT_TYPES` registry (`arrangement.conference`, `family.meeting`, `viewing`, `visitation`, `funeral.service`, `graveside.service`, `witness.cremation`, `crematory.appointment`, `cemetery.appointment`, `staff.meeting`, `internal.event`), each entry carrying a `category` (`'family_facing' | 'operational' | 'internal'`) and a `displayName` never derived from the key. `Appointment.appointmentType` is typed as plain `string`, validated against the registry at the service boundary — a new appointment type is a new registry entry, never a data-model or union change (identical to how `CaseDocument.documentTypeKey` already works against `DOCUMENT_TYPES`).

## Lifecycle: a real Draft stage, independent of the activity log

```
Draft → Scheduled → Confirmed → In Progress → Completed
                                             ↘ Cancelled
                                             ↘ No Show
```

`Draft` mirrors the proven `draft → pending` two-phase pattern from `SignatureRequest`: `createAppointment` inserts as `Draft` when resources are incomplete or the caller explicitly asks to save a placeholder (`saveAsDraft`), advancing to `Scheduled` only once conflict-checked resource assignments succeed. `Completed`/`Cancelled`/`No Show` are terminal — `isTerminalAppointmentStatus()` guards every mutating function; a row that reaches one of these three is never edited again, and a correction is always a new `Appointment`.

**This state machine is authoritative and independent of `ActivityEvent`.** Events narrate transitions; nothing ever queries them to determine current status — a restatement of the same invariant ADR-028 established for the activity log generally, made explicit here because this is the first entity whose own lifecycle state could plausibly be confused with its audit trail.

Every appointment also carries `correlationId`, `createdBy`, and — a genuinely new field pattern for this codebase — **`lastModifiedBy`**, the first "generic last-editor" field. Justified specifically because an `Appointment`, unlike `CaseDocument`/`SignatureRequest`, is routinely edited multiple times before reaching a terminal state, rather than having a handful of named, single-purpose actor fields like `cancelledBy`.

## Conflict detection: hard blocks, soft warnings, always-audited overrides

`services/scheduling/conflictEngine.ts`'s `checkConflicts()` returns `{ hardConflicts, softConflicts }`, never a single throw-or-succeed:

- **Hard** (blocks save without an authorized override): an overlapping active `AppointmentResourceAssignment`, an overlapping `ResourceUnavailability` window, or the resource's own `status` being `out_of_service`/`archived`.
- **Soft** (warning only, never blocks): resource `status: 'maintenance'`, or the requested window falling inside a configurable buffer/turnaround gap (default 15 minutes) adjacent to another booking for the same resource — a bounded, explicit check, deliberately not a step toward "resource optimization" (out of scope).
- **External resources** (`isExternal: true` — a cemetery, an outside florist) are never conflict-checked at all; Beacon has no visibility into a vendor's real availability.
- Every hard-conflict override always emits `scheduling.resource.conflict_overridden` (`severity: 'critical'`), naming exactly what was overridden, by whom, and the given reason. Soft conflicts never require or produce an override event.

`schedulingService.ts` computes `hardConflicts` exactly once per call and reuses it for both the throw-check and the override-recording decision — an earlier draft called `checkConflicts` twice for these two purposes, corrected before implementation was considered complete.

## Resource lifecycle states, not a boolean

`Resource.status: 'active' | 'maintenance' | 'out_of_service' | 'archived'` replaces a plain `isActive` flag — complementary to, not redundant with, the separate `ResourceUnavailability` collection: `status` is the resource's own standing/general usability; `ResourceUnavailability` is a time-bounded exception layered on top (e.g., a generally-`active` vehicle in the shop for a specific week).

## Recurrence: an immutable definition, materialized occurrences, per-occurrence exceptions

A `RecurrenceDefinition` (`frequency`, `interval`, `byWeekday`, `count`/`until`) is created once and **never edited again** — a changed pattern always creates a new definition, mirroring the "corrections create new, never mutate" discipline already established for `SignatureRequest`/`CaseDocument`. This is a deliberate redesign from an earlier "rule blob on the first appointment" approach considered during planning.

Each occurrence is still **materialized** as its own real, independently-editable `Appointment` row — kept from the original design, avoiding a query-time-expansion engine this codebase has never needed — carrying `recurrenceDefinitionId` and `isRecurrenceException: boolean`. Rescheduling one occurrence sets `isRecurrenceException: true` on that row alone; the definition and every sibling are untouched (live-verified: the definition row and an unrelated sibling occurrence are byte-for-byte unchanged after a reschedule).

Materialization is capped at **104 occurrences or 2 years out, whichever comes first** (`MATERIALIZATION_CAP_COUNT`/`MATERIALIZATION_CAP_YEARS`, exported constants) — explicit and documented, never silently truncated. A hard conflict on any occurrence beyond the first never aborts the whole series: that one occurrence is created as `Draft` with no resource assignments (needing staff attention), while the rest of the batch proceeds normally.

## One orchestration layer, no duplication

- **`services/resourceService.ts`** — pure `Resource`/`ResourceUnavailability` CRUD and `getAvailability` reads. No conflict logic, no `Appointment`/`AppointmentResourceAssignment` writes.
- **`services/scheduling/conflictEngine.ts`** — pure hard/soft detection, reading via `resourceService.ts`. No writes at all.
- **`services/scheduling/recurrenceEngine.ts`** — `RecurrenceDefinition` creation (its own one write) and pure `computeOccurrences` date-math. No `Appointment` writes.
- **`services/scheduling/appointmentReads.ts`** — pure `Appointment`/`AppointmentResourceAssignment` reads (`listAppointments`, `getAppointment`, `listAppointmentsForCase`), deliberately factored out of `schedulingService.ts` to break a circular import: `documentService.ts` needs these reads for the merge engine, but `schedulingService.ts` itself imports `signatureService.ts` (for the witness-signature integration), which imports `documentService.ts` — so `documentService.ts` can never import `schedulingService.ts` directly. This file has no dependency on `conflictEngine`/`recurrenceEngine`/`activityService`/`signatureService`; `schedulingService.ts` imports and re-exports its three functions so its own public API is unchanged.
- **`services/schedulingService.ts`** — the sole orchestration layer. The only file permitted to import `conflictEngine.ts`, `recurrenceEngine.ts`, the eight `recordAppointment*`/`recordResource*` `ActivityService` helpers, and any future concrete `SchedulingNotifier` implementation.

Structurally enforced by `schedulingService.test.ts`'s "orchestration boundary" describe block (five assertions, mirroring `signatureService.test.ts`'s own source-tree-walk pattern): only `schedulingService.ts` imports the conflict engine; only it imports the recurrence engine; only it imports the eight activity helpers; only it imports `lib/schedulingNotifier.ts`; no file other than `resourceService.ts`/`schedulingService.ts` writes to `appointments`/`appointmentResourceAssignments`/`resources`/`resourceUnavailability` directly (`recurrenceDefinitions`' write-boundary is enforced transitively: only `recurrenceEngine.ts` writes it, and only `schedulingService.ts` may import `recurrenceEngine.ts`).

## Notification: reserved, no concrete implementation

`lib/schedulingNotifier.ts` defines the `SchedulingNotifier` interface (`notifyAppointmentCreated`/`notifyAppointmentRescheduled`/`notifyAppointmentCancelled`/`notifyReminder`), mirroring `SignatureNotifier`'s exact shape — deliberately **not** wired to real delivery this phase, an explicit difference from ADR-030, where notification delivery was load-bearing to the signing flow. Scheduling has no equivalent hard dependency on delivery succeeding.

## Witness Cremation: reuses the existing signing mechanism, no parallel path

`types/signatureRequest.ts`'s `SignerRole` is widened to add `'witness'` — the exact extension ADR-030 already reserved. `schedulingService.createWitnessSignatureRequest()` is a thin wrapper calling `signatureService.createSignatureRequest` directly with `signerRole: 'witness'`; there is no second signing mechanism. The staff-facing `signature-requests` route's own `VALID_SIGNER_ROLES` list deliberately excludes `'witness'` — it is only reachable programmatically via `createWitnessSignatureRequest`, never picked from the general Request Signature dialog (`RequestSignatureDialog.tsx`'s `SIGNER_ROLE_LABEL` map is typed `Record<Exclude<SignerRole, 'witness'>, string>` accordingly).

## Merge engine: `case.service.date`/`case.service.location` resolved from the canonical scheduling model

Both fields flip from `wired: false` to `wired: true` in `domain/documents/mergeEngine.ts`, resolved via two new `MergeSourceData` fields — `serviceAppointment: Appointment | null` and `serviceAppointmentLocation: OrganizationLocation | null` — populated by `documentService.ts`'s `resolveMergeSourceData` through `services/scheduling/appointmentReads.ts`'s `listAppointmentsForCase`, filtered to the case's nearest non-cancelled `funeral.service`/`graveside.service` appointment, never a document-specific scheduling lookup. `Appointment.startAt` (raw ISO) is reformatted to `MM/DD/YYYY` via a small `formatDateOnly()` helper in `mergeEngine.ts`, matching the display convention of `Case.dateOfBirth`/`dateOfDeath` (already user-typed `MM/DD/YYYY` strings). Both fields resolve to the reserved placeholder, exactly like every other wired-but-unavailable merge field, when the case has no such appointment yet — no special-cased "still reserved" behavior remains.

## Permissions

Six new keys: `schedule.read`, `schedule.create`, `schedule.edit`, `schedule.cancel`, `resource.manage`, `calendar.manage` (reserved for a future org-wide calendar settings surface — no dedicated UI ships this phase). Tiered by mirroring existing precedent exactly: `schedule.read` mirrors `document.view` (every role except accounting); `schedule.create`/`.edit` mirror `document.generate`/`signature.request` (every role except accounting, readOnly); `schedule.cancel` mirrors `document.archive`/`signature.cancel` (administrator/manager/funeralDirector only); `resource.manage`/`calendar.manage` mirror `document.template.manage`/`signature.manage` (administrator/manager only). Total permission count moves from 32 to **38**. `authorizationPolicyService.ts` gains `canReadSchedule`/`canCreateAppointment`/`canEditAppointment`/`canCancelAppointment`/`canManageResources`/`canManageCalendar`.

## Calendar UI has no persistence of its own

Day/Week/Month/Agenda are pure client-side projections of the identical `GET /api/scheduling/appointments` query, parameterized only by date-range/grouping — never separately fetched, cached under a different shape, or persisted per view type. Calendar-grid/date-range math is hand-rolled against native `Date`/`Intl.DateTimeFormat` — no new date-library dependency, consistent with this codebase's "only add infrastructure the phase actually needs" discipline.

## Live Wix verification

All five new collections (`resources` — Collection 37; `resourceUnavailability` — Collection 38; `recurrenceDefinitions` — Collection 39; `appointments` — Collection 40; `appointmentResourceAssignments` — Collection 41) were created live via `POST /wix-data/v2/collections`, discovering the correct request shape (`{"collection": {"id", "displayName", "fields": [...] }}`, field types `TEXT`/`NUMBER`/`BOOLEAN`/`DATETIME`/`OBJECT` — confirmed against the existing `cases` collection's own field-type list) on the first collection and reusing it for the remaining four. All ten planned indexes were then created via the proven `POST /wix-data/v2/indexes` shape and confirmed `ACTIVE`; the index cap (`{"regular":3,"unique":1,"total":4}`) was reconfirmed on every new collection via its own creation response.

Using two throwaway organizations and a shared `caseId` string across both, exercised through the real `resourceService.ts`/`schedulingService.ts` functions with `DATA_ADAPTER=wix`:

- A staff resource (`linkedMembershipId` round-tripped correctly), a chapel, and a vehicle were created; the vehicle's `status` was cycled `active → maintenance → out_of_service → active`, each transition round-tripping through the real mapper.
- A Draft appointment created with no resources confirmed it never auto-advances; adding a resource via `updateAppointmentResources` confirmed the `Draft → Scheduled` promotion.
- A weekly ×4 recurring appointment confirmed one `RecurrenceDefinition` row plus four materialized `Appointment` rows all sharing it; rescheduling the second occurrence confirmed `isRecurrenceException: true` on that row alone, with the definition row and every sibling occurrence unchanged.
- An overlapping booking against the same (non-external, `active`) vehicle resource was confirmed hard-rejected; retrying with an explicit override succeeded and recorded `scheduling.resource.conflict_overridden`; a booking falling inside the default 15-minute buffer adjacent to the overridden booking confirmed a soft conflict with zero hard conflicts.
- Cancelling one appointment and completing another both confirmed every live resource assignment was released (`releasedAt` set); attempting to reschedule the cancelled appointment was confirmed rejected.
- All eight `scheduling.*` activity event types were confirmed recorded for the exercised organization.
- Cross-tenant isolation was confirmed: a second organization's resource and appointment (sharing the same `caseId` string) never appeared in the first organization's `list`/`getAppointment` results.
- Every row created — across all five new collections plus `activityEvents` — was deleted afterward via `$startsWith` queries against the throwaway organization-id prefix; a final query confirmed zero rows remained anywhere.

## Deferred

- Google Calendar sync, Outlook sync, ICS feed generation, vehicle routing, SMS reminders, an email reminder platform, resource optimization, automatic scheduling, GPS tracking, fleet telematics, payroll, time clock — explicitly out of scope (see Context). Each has a named extension point, no stub implementation.
- `SchedulingNotifier` concrete delivery — the interface is reserved; nothing sends a real notification yet.
- A `recurrenceDefinitionId` index on `appointments` — omitted given the materialization cap bounds any "edit this and all following" scan to at most 104 rows; documented in `docs/WIX_DATA_SCHEMA.md`'s Known Limitations.
- Compound-unique double-booking prevention at the database level — Wix Data has no such support; conflict prevention remains application-enforced only, an accepted risk matching `organizationMemberships (userId, organizationId)`'s own precedent.
