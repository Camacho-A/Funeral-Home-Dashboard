# ADR-016: Wix Write Integration

**Status:** Accepted
**Date:** 2026-07-23

## Context

Phases 15A–15E built Wix-backed reads for organizations, workflow templates, cases, and tasks, while every write (`casesService.create/update`, `tasksService.create/update/remove`) stayed mock-only — a documented, deliberate limitation (ADR-013, ADR-014): a case or task created or edited while `DATA_ADAPTER=wix` would not appear in a subsequent Wix-sourced read, because it was never actually written to Wix. Phase 15X then closed the server-side authorization gap for reads (`requireAuthorizedOrganization`). This phase closes the write gap, reusing that same authorization layer.

## Architecture review findings (performed before implementation)

1. **Existing write methods** (`casesService.create/update`, `tasksService.create/update/remove`) are pure client-side functions mutating shared `caseFixtures`/`taskFixtures` arrays — the same mock state `list`/`get` already share (established in ADR-013/014).
2. **Wix collection schema** (`docs/WIX_DATA_SCHEMA.md`) already specifies mutable/immutable per field for both `cases` and `tasks`, and already records an unapplied implementation decision: set the Wix item's own system `_id` to `beaconCaseId`/`beaconTaskId` at insert time, so a single-record lookup is served by Wix's own system index rather than needing a 4th collection index Wix Data doesn't allow. This phase applies that decision for the first time.
3. **`updateDataItem` (PUT) is a full replace**, confirmed against Wix's own REST documentation: "after an item is updated, it only contains the fields included in the payload... fields not included, their values are lost." Every update in this phase is therefore read-modify-write: query the existing item first (which also serves as the tenant-ownership check), merge an allowlisted patch onto it, then `PUT` the complete merged object.
4. **Case creation does not generate `CaseTask` records.** Checklist state lives inline on the `Case` record (`checklistState`/`fieldValues`); no domain rule anywhere creates task rows from a workflow template. Confirmed by inspection; nothing was invented here.
5. **One real ambiguity, flagged and resolved rather than guessed at**: `Case.createdBy`/`intakeOwnerId` are documented as session-derived, but `hooks/useSession.ts` remains a hardcoded `StaffProfile`-id stub, never unified with the real `AuthorizationContext.userId` (an `AuthenticatedUser`-id) established in Phase 13 — an identity-space fork flagged and deliberately deferred since Phase 13, explicitly called out again in Phase 15D's context as "before/during Phase 16." Resolution: continue sourcing these fields from the client's `useSession()`, passed as ordinary request-body business data, never as an authorization input — the same trust model already in place, extended rather than redesigned. `organizationId` remains the only value any write handler treats as security-relevant, and it is never taken from the body beyond a *requested* hint re-verified via `requireAuthorizedOrganization`.

## Decision

### Wix data adapter (writes)

`lib/wixDataApi.ts` gained `insertWixDataItem`, `updateWixDataItem` (full-replace, PUT), and `deleteWixDataItem` — thin REST wrappers matching `queryWixDataItems`'s existing style exactly. `insertWixDataItem` accepts an optional `itemId`, used to set `_id = beaconCaseId`/`beaconTaskId` at insert time (see finding 2).

### Mappers (write side)

`lib/wixCaseMapper.ts` and `lib/wixTaskMapper.ts` each gained three functions, mirroring their existing read-side responsibility as "the one place a raw Wix item shape is ever touched":
- `buildWix*Data` — builds a complete Wix `data` object for insertion, from server-derived and validated input only.
- `validateAndPickWix*Update` (named `validateAndPickCaseUpdate`/`validateAndPickTaskUpdate`) — a **runtime allowlist**, since a raw HTTP JSON body has no compile-time protection the way `CaseUpdate`/`TaskUpdate` types already give the mock path. Any key not in the allowlist (`organizationId`, `workflowTemplateId`, `intakeOwnerId`, `createdBy`, `caseId`, `id`, `createdAt`, or anything unrecognized) is **silently dropped**, never applied, even if present in the body. A present-but-wrong-typed *allowed* field is rejected outright (400), not coerced or silently dropped — "do not allow arbitrary object spreading into Wix updates."
- `applyWix*UpdateToWixData` — merges a validated patch onto an existing full record (renaming Beacon field names to their Wix equivalents), producing the complete object `updateWixDataItem`'s full-replace semantics require.

### Route Handlers

- `POST /api/cases` — creates a case. Resolves the organization's enabled workflow template **entirely server-side** (the same "first enabled" rule `useCreateCase.ts` already used client-side, now reusable via `lib/wixWorkflowTemplateMapper.ts`'s `fetchWixWorkflowTemplates`, moved there from the workflow-templates route in this phase specifically so this route could import it without duplicating the join logic) — a client-supplied `workflowTemplateId`/snapshot is never trusted, even if present in the body.
- `PATCH /api/cases/[caseId]` — updates a case. Re-fetches by `{beaconCaseId, organizationId}` first (tenant check + full data for the merge); a case belonging to another organization is `404`, identical to a fabricated id.
- `POST /api/tasks` — creates a task. If `caseId` is provided, it's independently re-verified to belong to the same organization via a fresh Wix query before the task is created — "if the task belongs to a case, verify tenant consistency."
- `app/api/tasks/[taskId]/route.ts` (new file — Phase 15D never needed a get-by-id route for tasks, but `PATCH`/`DELETE` inherently need a task id in the path) — updates or deletes a task, same re-fetch-first pattern.

Every write handler calls `requireAuthorizedOrganization` immediately, before any validation or Wix I/O — reused verbatim from Phase 15X, no new authorization logic written.

**Deliberate simplification:** all four write handlers require `DATA_ADAPTER=wix` (returning a clear `400` otherwise) rather than also implementing a parallel mock-mode branch. Unlike the read routes (which have symmetric mock branches "for defense-in-depth," since `list`/`get` sometimes exercise them in tests), these write routes are **never reached at all** when `dataAdapterMode` is `"mock"` — `casesService.create`/`update` and `tasksService.create`/`update`/`remove`'s mock branches never call `fetch()`. A mock-mode branch here would duplicate the client-side mock logic in a form that could never be exercised by the running app, only by a hand-crafted test or `curl` call — not worth the duplication risk for zero practical benefit.

### Client services

`casesService.create/update` and `tasksService.create/update/remove` each gained the same `dataAdapterMode` parameter `list`/`get` already had (ADR-013/014's established pattern). When `"mock"` (the default), every one of them is byte-for-byte the pre-Phase-16 fixture-mutating code. When `"wix"`, they `POST`/`PATCH`/`DELETE` the corresponding Route Handler instead. No client-side authorization logic was added anywhere — these functions only forward requests; the Route Handler is where `organizationId` is ever actually verified.

### Hooks / TanStack Query

`useCreateCase`, `useCaseMutations`, `useCaseTasks`, `useTaskMutations` all now pass `organization.dataAdapterMode` into their respective service calls — the same one-line addition pattern used for `useCases`/`useCase`/`useTasks` in Phases 15C/15D. Cache invalidation was reviewed and required **no changes**: every query key already led with `organizationId` (confirmed in Phase 15E), and the existing `invalidateQueries({queryKey: ['cases', orgId]})` / `['tasks', orgId]` calls already cover the Dashboard (reads `['cases', orgId, ...]`) and Case Detail (`['case', orgId, caseId]` is `setQueryData`'d directly by `useCaseMutations`) correctly, in both mock and wix mode.

## Consequences

- **Read-after-write now genuinely works in `DATA_ADAPTER=wix`.** Creating or updating a case/task persists to the real Wix collection and is visible on refresh via the unmodified Phase 15C/15D read path — this is the gap ADR-013/014 documented and this phase closes.
- **Partial-failure / atomicity:** Wix Data has no multi-item transaction API exposed here, and this phase introduces no multi-write operation that would need one (no task-from-template generation exists, per finding 4) — every write in this phase is a single `insertWixDataItem`/`updateWixDataItem`/`deleteWixDataItem` call against one collection. A failure is a single, whole-operation failure: the route returns `503` with a generic message, and nothing partially applies (there's no second write to roll back). The one place a two-step sequence exists — task creation's `caseId` tenant-consistency check (a query) followed by the insert — has no partial-failure state either: if the query fails or finds nothing, the insert never happens at all.
- **Known limitation, not resolved here:** `createdBy`/`intakeOwnerId` continue to be sourced from `useSession()`'s hardcoded stub rather than a real server-resolved identity — Identity Model Hardening remains explicitly deferred (see finding 5).
- **`AUTH_ADAPTER=mock` + `DATA_ADAPTER=wix` continues to work** — verified live; no authentication-path code was touched by this phase at all.

## Alternatives Considered

- **A parallel mock-mode branch inside the new write Route Handlers**, matching the read routes' symmetric shape: rejected as unreachable-in-practice duplication (see "Deliberate simplification" above).
- **Trusting a client-supplied `workflowTemplateId`/snapshot at case-create time**: rejected — would let a forged value smuggle another organization's proprietary workflow structure into a case permanently. The server re-resolves it independently instead.
- **Wix's `patchDataItem` (true partial field-level PATCH)** instead of read-modify-write via `updateDataItem`: rejected as unnecessary complexity — it requires hand-encoding each field into a `SET_FIELD`/`Value`-oneof wrapper (string/number/bool/struct/list variants), a real source of subtle bugs, for a benefit (skipping one query) this project's write volume doesn't need. The read-modify-write approach was already empirically proven correct in this exact codebase during Phase 15E's live manual verification.
